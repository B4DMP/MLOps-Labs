import argparse
import time
from playwright.sync_api import sync_playwright

def get_clean_text(locator, is_answer=False):
    if locator.count() == 0:
        return ""
    
    # We clone the node to safely remove nested comments,
    # then extract text ONLY from semantic markdown elements (h1-h6, p, ul, etc)
    # This automatically ignores avatars, buttons, upvote counts, and tags.
    text_blocks = locator.first.evaluate('''el => {
        let clone = el.cloneNode(true);
        let nested = clone.querySelectorAll('[data-testid="discussions-comment"]');
        nested.forEach(n => n.remove());
        
        let elements = clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre');
        let blocks = [];
        elements.forEach(e => {
            let parent = e.parentElement;
            let isNested = false;
            while(parent && parent !== clone) {
                if (['P','UL','OL','BLOCKQUOTE','PRE'].includes(parent.nodeName)) {
                    isNested = true; 
                    break;
                }
                parent = parent.parentElement;
            }
            if (!isNested && e.innerText && e.innerText.trim() !== "") {
                blocks.push(e.innerText.trim());
            }
        });
        return blocks;
    }''')
    
    # Text blocks now contain the actual sections
    # In answers, the first few blocks are Author and "Posted ..."
    blocks = [b.strip() for b in text_blocks]
    
    if is_answer and len(blocks) >= 2:
        if blocks[1].startswith('Posted ') or (len(blocks) >= 3 and blocks[1] == 'TOPIC AUTHOR' and blocks[2].startswith('Posted ')):
            if blocks[1] == 'TOPIC AUTHOR':
                blocks = blocks[3:]
            else:
                blocks = blocks[2:]
                
    # Remove trailing numbers like comment counts
    while blocks and (not blocks[-1] or blocks[-1].isdigit()):
        blocks.pop()
        
    return '\n\n'.join(blocks)

def extract_qa(url, amount=-1, output_file="kaggle_qa.txt"):
    print(f"Starting extraction from {url}...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print("Navigating to the forum page...")
        page.goto(url, timeout=60000)
        
        print("Waiting for topics to load...")
        page.wait_for_selector('a[href^="/discussions/questions-and-answers/"]', timeout=30000)
        
        processed_urls = set()
        extracted_count = 0
        retries = 0
        
        mode = "infinite" if amount == -1 else f"target: {amount}"
        print(f"Starting extraction loop (mode: {mode}). Press Ctrl+C to stop anytime.")
        
        with open(output_file, "w", encoding="utf-8") as f:
            f.write("") # Clear the file initially
            
        try:
            while amount == -1 or extracted_count < amount:
                # Find all topics currently on the page
                links = page.query_selector_all('a[href^="/discussions/questions-and-answers/"]')
                new_urls = []
                for link in links:
                    href = link.get_attribute("href")
                    if href and "/new" not in href:
                        full_url = "https://www.kaggle.com" + href.split('#')[0]
                        if full_url not in processed_urls:
                            new_urls.append(full_url)
                
                # If we didn't find any new links, scroll down to load more
                if not new_urls:
                    print("No new topics found. Scrolling to load more...")
                    page.evaluate("window.scrollBy(0, document.body.scrollHeight)")
                    time.sleep(3)
                    retries += 1
                    if retries >= 4:
                        print("Reached bottom of forum or no more topics loading. Stopping extraction.")
                        break
                    continue
                else:
                    retries = 0
                
                # Process the new batch of URLs
                print(f"Found {len(new_urls)} new topics. Processing batch...")
                
                for topic_url in new_urls:
                    if amount != -1 and extracted_count >= amount:
                        break
                        
                    processed_urls.add(topic_url)
                    print(f"Processing topic (Found {extracted_count} pairs so far): {topic_url}")
                    
                    try:
                        # Open topic in a new tab so we don't lose our scroll position on the main page
                        topic_page = browser.new_page()
                        topic_page.goto(topic_url, timeout=30000)
                        topic_page.wait_for_selector('[data-testid="discussions-topic-header"]', timeout=15000)
                        time.sleep(2)
                        
                        question_loc = topic_page.locator('[data-testid="discussions-topic-header"]')
                        question = get_clean_text(question_loc)
                        
                        comments_loc = topic_page.locator('[data-testid="discussions-comment"]')
                        answer = get_clean_text(comments_loc.first, is_answer=True) if comments_loc.count() > 0 else ""
                        
                        if answer == "This comment has been deleted.":
                            if comments_loc.count() > 1:
                                answer = get_clean_text(comments_loc.nth(1), is_answer=True)
                            else:
                                answer = ""
                                
                        topic_page.close()
                        
                        if question and answer:
                            extracted_count += 1
                            print(f" -> Successfully extracted Q&A pair.")
                            
                            # Append instantly to the file
                            with open(output_file, "a", encoding="utf-8") as f:
                                f.write(question + "\n\n")
                                f.write(answer + "\n\n\n")
                        else:
                            print(f" -> Empty question or no answer found. Skipping.")
                            
                    except KeyboardInterrupt:
                        # Allow KeyboardInterrupt to break out of the script cleanly
                        raise
                    except Exception as e:
                        try:
                            topic_page.close()
                        except:
                            pass
                        print(f" -> Error processing topic {topic_url}: {e}")
            
        except KeyboardInterrupt:
            print("\nExtraction interrupted by user.")
            
        finally:
            browser.close()
            
    print(f"Extraction stopped. Total pairs extracted: {extracted_count}")
    print(f"Results saved progressively to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract Kaggle Q&A pairs")
    parser.add_argument("--url", default="https://www.kaggle.com/discussions/questions-and-answers?sort=hotness", help="Kaggle forum URL")
    parser.add_argument("--amount", type=int, default=10, help="Maximum number of Q&A pairs to extract. Use -1 for infinite scrolling.")
    parser.add_argument("--output", default="kaggle_qa.txt", help="Output text file")
    args = parser.parse_args()
    
    extract_qa(args.url, args.amount, args.output)
