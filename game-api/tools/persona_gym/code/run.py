from .utils import *
from .eval_tasks import *
import ast
import argparse
import os
import json
from .personas import *
import logging
import re
from pathlib import Path
from mlops_serious_game.config import settings
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

_BASE_DIR = Path(__file__).parent.parent  # = persona_gym/

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    handlers=[logging.StreamHandler()])

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def extract_list(original_string):
    list_string = original_string.replace("```python", "")
    list_string = list_string.replace("```", "")
    list_string = list_string.lstrip().rstrip()
    actual_list = ast.literal_eval(list_string)
    return actual_list

# Short-listing relevant scenarios/enviornments
def select_settings(persona):
    settings_prompt = f'''
                        Given the following persona description, select at least 3 and at most 10 most relevant settings from the given settings options for the persona. 
                        Your output must be ONLY the selected settings in a python list format (e.g., ["Setting 1", "Setting 2", ...]) with NO other text, names, or code blocks.
                        
                        Persona: {persona}
                        Settings Options: {settings_list}
                        Selected Settings List:
                      '''
    selected_settings  = run_model(input_prompt=settings_prompt, model_card=settings.SETTINGS_MODEL)
    selected_settings = extract_list(selected_settings)    
    return selected_settings

# Generate relevant questions given scenarios
def gen_questions(persona, scenario_settings, num_questions=10):
    questions = {task:[] for task in tasks}

    

    for task in tasks:
        description = question_requirements[task]
        question_prompt = f'''
                            You are tasked with determining if a person with the given persona description is able to answer questions related to {scenario_settings} that specifically test the given evaluation task. Generate exactly {num_questions} challenging multi-step questions to do this where the questions are intended to be asked directly to the persona. You may use the question description below to guide you. Your output must be the generated questions in a python list format with no other verbose.
                            Persona: {persona}
                            Settings: {scenario_settings}
                            Evaluation Task: {task}
                            Questions Description: {description}
                            Questions: 
                      '''
        task_questions = []
        for _ in range(5):
            try:
                task_questions  = run_model(input_prompt=question_prompt, model_card=settings.QUESTION_MODEL)
                task_questions = extract_list(task_questions)
            except Exception as e:
                print(f"Error generating questions for task {task}: {e}")
                continue
            if len(task_questions) == num_questions:
                break

        
        questions[task].extend(task_questions)

    return questions

def process_examples(text):
    matches = re.findall(r'Score (\d+): *Response - *"?(.*?)"?(?=\n*Score \d+: *Response -|$)', text, re.S)
    processed_text = '\n\n'.join(f'Score {score}: \"{response.strip()}\"' for score, response in matches)

    lines = processed_text.split("\n")
    filtered_lines = [line for line in lines if line.startswith("Score")]

    return "\n\n".join(filtered_lines)

def parse_full_examples(text):
    rubrics = re.split(r'Rubric \d+ Examples:', text)
    if rubrics[0].strip() == '':
        rubrics.pop(0)
    rubrics = [rubric.strip() for rubric in rubrics]
    
    return rubrics

def gen_score_examples(persona, qa, rubric, model):
    examples_rubric = open(_BASE_DIR / 'prompts/score_examples/parallel_examples.txt').read()
    rubrics = []
    for question, _ in qa:
        score_prompt = open(_BASE_DIR / 'prompts/score_examples/prompt.txt').read()
        score_prompt = score_prompt.format(persona = persona, question = question, rubric = rubric)
        rubrics.append(score_prompt)

    prompt = examples_rubric.format(rubrics=rubrics)


    examples = run_model(input_prompt=prompt, temperature=0, top_p=0.01, model_card=model)



    examples = process_examples(examples)
    return examples

def parse_rubric(rubric):
    match_segment = re.search(r"Therefore, the final score is\s*(\d+)", rubric)
    if match_segment:
        return int(match_segment.group(1))
    return 0

def format_rubrics(persona, rubric, qa):
    sys_prompt = open(_BASE_DIR / 'prompts/rubric_grading/sys_prompt.txt').read()
    prompt_outline = open(_BASE_DIR / 'prompts/rubric_grading/prompt.txt').read()
    rubrics = []

    examples = gen_score_examples(persona, qa, rubric, settings.EXAMPLE_MODEL)
    # examples may be a list (parsed correctly) or a plain string (fallback/error)
    examples_list = examples if isinstance(examples, list) else [examples] * len(qa)
    for i in range(len(qa)):
        question, answer = qa[i]
        score_examples = examples_list[i] if i < len(examples_list) else ""
        formatted_rubric = rubric.format(persona = persona, question = question, response = answer, score_example = score_examples)
        rubrics.append(formatted_rubric)

    
    scoring_prompt = prompt_outline.format(rubrics = rubrics)

    return sys_prompt, scoring_prompt

def parse_evaluations(text):
    pattern = r'\(\d+\) Evaluation:(.*?)(?=\(\d+\) Evaluation:|$)'
    evaluations = re.findall(pattern, text, re.DOTALL)
    evaluations = [eval.strip() for eval in evaluations]
    return evaluations

def calculate_modified_average(score_list):
    total_sum = sum(score_list)
    zero_count = score_list.count(0)
    mod_total = len(score_list) - zero_count

    return total_sum / mod_total if mod_total > 0 else total_sum

def score_rubrics(sys_prompt, scoring_prompt, num_evals=1):
    scores = []

    for _ in range(num_evals):
        evaluator1 = run_model(input_prompt=scoring_prompt, temperature=0, top_p=0.01, model_card=settings.EVAL_1, system = sys_prompt)
        evaluator2 = run_model(input_prompt=scoring_prompt, temperature=0, top_p=0.01, model_card=settings.EVAL_2, system = sys_prompt)

        evaluator1 = parse_evaluations(evaluator1)
        evaluator2 = parse_evaluations(evaluator2)

        scores1 = [parse_rubric(rubric) for rubric in evaluator1]
        scores2 = [parse_rubric(rubric) for rubric in evaluator2]

        score1 = calculate_modified_average(scores1)
        score2 = calculate_modified_average(scores2)

        scores.append(score1)
        scores.append(score2)
    
    return sum(scores) / len(scores)



async def gen_answers(stakeholder_name, questions):
    task_to_qa = {}

    for task in questions:
        task_to_qa[task] = []
        task_questions = questions[task]

        for question in task_questions:
            answer = await run_stakeholder_graph(question=question, stakeholder_name=stakeholder_name)
            if "]" in answer:
                try:
                    answer = answer.split("]", 1)[1].strip()
                except Exception:
                    pass
            task_to_qa[task].append((question, answer))
    
    return task_to_qa


def score_answers(persona, task_to_qa, score_example=True):
    scores = {task:[] for task in task_to_qa}
    for task in task_to_qa:
        for i in range(0, len(task_to_qa[task]), 5):
            selected_qa = task_to_qa[task][i: i + 5]
            rubric = open(_BASE_DIR / f'rubrics/{task}.txt').read()
            sys_prompt, scoring_prompt = format_rubrics(persona, rubric, selected_qa)

            scores[task].append(score_rubrics(sys_prompt, scoring_prompt))

    
    for task in list(scores.keys()):
        if len(scores[task]) > 0:
            scores[task] = sum(scores[task]) / len(scores[task])
        else:
            scores[task] = 0.0
    
    return scores


def save_responses(stakeholder_name, task_to_qa, eval_name):
    dir = _BASE_DIR / f"results/{eval_name}"
    if not os.path.exists(dir):
        os.makedirs(dir)

    with open(dir / f'{stakeholder_name}_qa.json', 'w') as file:
        json.dump(task_to_qa, file, indent=4)

def save_scores(save_name, scores):
    dir = _BASE_DIR / f"scores/{save_name}"
    if not os.path.exists(dir):
        os.makedirs(dir)

    with open(dir / 'scores.json', 'w') as file:
        json.dump(scores, file, indent=4)
      
      
def load_questions(file_name, saved_questions):
    dir = _BASE_DIR / f"questions/{saved_questions}"
    if not os.path.exists(dir):
        print(f"No questions directory {dir}")
        exit(0)
    
    file_path = dir / f'{file_name}.json'
    if not os.path.exists(file_path):
        print(f"No JSON file {file_path}")
        exit(0)

    with open(file_path, 'r') as file:
        questions = json.load(file)

    return questions

def load_responses(persona, saved_responses): 
    dir = saved_responses
    if not os.path.exists(dir):
        print(f"No responses directory {saved_responses}")
        exit(0)
    
    file_path = f'{dir}/{persona}_qa.json'
    if not os.path.exists(file_path):
        print(f"No JSON file {file_path}")
        exit(0)

    with open(file_path, 'r') as file:
        task_to_qa = json.load(file)

    return task_to_qa
    

async def main(stakeholder_id, eval_name= "stakeholder_evaluation", saved_questions=None, saved_responses=None):
    
    persona= StakeholderFactory.get_stakeholder(StakeholderFactory.get_available_stakeholders()[stakeholder_id]).get_profile_string()
    if saved_responses:
      task_to_qa = load_responses(persona, saved_responses)

    else:
      if saved_questions:
        questions = load_questions(StakeholderFactory.get_available_stakeholders()[stakeholder_id], saved_questions)
        
      else:
        scenario_settings = select_settings(persona)
        questions = gen_questions(persona, scenario_settings)
        
      task_to_qa = await gen_answers(f"{StakeholderFactory.get_available_stakeholders()[stakeholder_id]}", questions)
        
    scores = score_answers(persona, task_to_qa)
    overall = 0
    for task in scores:
        overall += scores[task]
    
    overall /= len(scores.keys())
    scores["PersonaScore"] = overall

    
    save_responses(StakeholderFactory.get_available_stakeholders()[stakeholder_id], task_to_qa, eval_name)


    return scores


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--persona_list", type=str, help="List of personas", default="[]")
    parser.add_argument("--model", type=str, help="A valid model name from the api options of: OpenAI, Claude, TogetherAI", default="meta-llama/Llama-2-70b-chat-hf")
    parser.add_argument("--model_name", help="Model name to save results", default=None)
    parser.add_argument("--saved_questions", help="Path to load in generated questions", default=None)
    parser.add_argument("--saved_responses", help="Path to load in generated question-answer pairs", default=None)
    parser.add_argument("--benchmark", type=str, help="flag for running benchmark", default=None)
    parser.add_argument("--save_name", type=str, help="unique name to identify saved scores", default="no_name_specified")

    args = parser.parse_args()

    if args.benchmark:
        persona_list = benchmark_personas
        saved_questions = args.benchmark
        saved_responses = None
    else:
        persona_list = eval(args.persona_list)
        saved_questions = args.saved_questions
        saved_responses = args.saved_responses

    results = {}
    scores = {}
    for i, persona in enumerate(persona_list):
        scores = main(persona, args.model, args.model_name, saved_questions, saved_responses)
        results[persona] = scores["PersonaScore"]
        logger.info(f'Done with {i + 1}/{len(persona_list)} personas')
    
    
    logger.info(results)
    if results:
        save_scores(args.save_name, scores)
    logger.info("Evaluation Done!")
    




