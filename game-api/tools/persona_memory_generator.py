import asyncio
import json
import os
import sys
from pathlib import Path

# Add src to sys.path so philoagents can be imported
sys.path.append(str(Path(__file__).parent.parent / "src"))

import click
from philoagents.config import settings
from philoagents.domain.stakeholder_factory import StakeholderFactory

from persona_gym.code.utils import *

_BASE_dir = Path(__file__).parent.parent

@click.command()
def main() -> None:
    """
    fill in persona memory questions    
    """
    print("started persona LTM generation")
    data_dir = _BASE_dir / f"data"
    if not os.path.exists(data_dir):
        print(f"No questions data_directory {data_dir}")
        exit(0)
    
    persona_questions_path = data_dir / 'long_term_memory_persona_questions.json'
    if not os.path.exists(persona_questions_path):
        print(f"No JSON file {persona_questions_path}")
        exit(0)

    with open(persona_questions_path, 'r') as file:
        questions = json.load(file)

        for st in StakeholderFactory.get_available_stakeholders():
            q_a=[]
            print(f"started with stakeholder {st}..")
            #generate responses
            for q in questions:
                response= asyncio.run(run_stakeholder_graph(StakeholderFactory.get_stakeholder(st).name,f"Hello {StakeholderFactory.get_stakeholder(st).name}, it is requried that you and ONLY YOU answer the following question: {q['question']}"))
                print(f" Question: {q} \n Response: {response}")
                try:
                    response=response.split("]",2)[1]
                finally:
                    q_a.append({"question":q["question"], "answer":response})
            #store question response pairs
            st_rag_path = data_dir / "stakeholder_extraction_data" / StakeholderFactory.get_stakeholder(st).name / "personaLTM.txt"
            os.makedirs(st_rag_path.parent, exist_ok=True)
            with open(st_rag_path, 'w', encoding='utf-8') as st_ltm:
                for q in q_a:
                    st_ltm.write("Question: "+q["question"]+"\n")
                    st_ltm.write("Answer: "+q["answer"]+"\n"+"\n")




if __name__ == "__main__":
    main()
