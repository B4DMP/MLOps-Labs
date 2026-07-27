import argparse
import time
import sys
import random
import traceback
from playwright.sync_api import sync_playwright

def get_clean_text(locator):
    """Extracts text content from a locator/element and cleans it."""
    if not locator:
        return ""
    
    # Check if it's a locator or element handle
    try:
        if hasattr(locator, 'count') and locator.count() == 0:
            return ""
    except:
        pass
    
    try:
        # We extract text from paragraphs and headers to avoid metadata/buttons
        text = locator.evaluate('''el => {
            const paragraphs = el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre');
            if (paragraphs.length > 0) {
                return Array.from(paragraphs).map(p => p.innerText.trim()).filter(t => t !== "").join('\\n\\n');
            }
            return el.innerText.trim();
        }''')
        return text
    except Exception as e:
        print(f"Error cleaning text: {e}")
        return ""

def safe_goto(page, url, timeout=60000, retries=3):
    """Navigates to a URL with retries."""
    for i in range(retries):
        try:
            print(f" -> Navigating to {url} (Attempt {i+1})...")
            page.goto(url, timeout=timeout, wait_until="load")
            return True
        except Exception as e:
            print(f" -> Warning: Attempt {i+1} failed: {e}")
        
        time.sleep(2 + random.random() * 2)
    return False

def extract_servicenow_qa(base_url, amount=10, output_file="servicenow_qa.txt"):
    """
    Extracts Q&A pairs from the ServiceNow GRC forum.
    """
    print(f"Starting ServiceNow extraction from {base_url}...")
    
    with sync_playwright() as p:
        print("Launching Chromium...")
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0"
        )
        page = context.new_page()
        
        processed_urls = set()
        extracted_count = 0
        current_page = 1
        
        # Clear/Create the file
        with open(output_file, "w", encoding="utf-8") as f:
            f.write("")

        try:
            while amount == -1 or extracted_count < amount:
                # Construct page URL if not first page
                page_url = base_url if current_page == 1 else f"{base_url}/page/{current_page}"
                print(f"\nScanning page {current_page}: {page_url}")
                
                if not safe_goto(page, page_url):
                    print(f"Error: Could not load forum page {page_url}. Stopping.")
                    break
                
                # Find topic links
                links = page.query_selector_all('a[href*="/td-p/"]')
                new_urls = []
                for link in links:
                    href = link.get_attribute('href')
                    if href and "/td-p/" in href:
                        # Full URL check (ServiceNow uses relative or full links sometimes)
                        if not href.startswith('http'):
                            href = "https://www.servicenow.com" + href
                        
                        # Normalize internal links (remove anchor)
                        href = href.split('#')[0]
                        
                        if href not in processed_urls:
                            new_urls.append(href)
                
                if not new_urls:
                    print("No more topics found on this page. Stopping.")
                    break

                print(f"Found {len(new_urls)} topics to process.")
                
                for topic_url in new_urls:
                    if amount != -1 and extracted_count >= amount:
                        break
                    
                    processed_urls.add(topic_url)
                    print(f"Processing post [{extracted_count+1}]: {topic_url}")
                    
                    # Random delay
                    time.sleep(random.uniform(2, 5))
                    
                    try:
                        post_page = context.new_page()
                        if not safe_goto(post_page, topic_url, timeout=60000):
                            print(f" -> Error: Could not load post. Skipping.")
                            post_page.close()
                            continue
                        
                        # Extract Title
                        title_el = post_page.query_selector('h1.lia-component-common-widget-page-title, h1')
                        title = title_el.inner_text().strip() if title_el else "No Title"
                        
                        # Extract Question Body (First message in the thread)
                        question_body = get_clean_text(post_page.query_selector('.lia-message-body-content'))
                        
                        # Extract Answer (Accepted Solution first)
                        # The research script confirmed 'div[class*="accepted-solution"]' works
                        solution_el = post_page.query_selector('div.lia-accepted-solution, div[class*="accepted-solution"]')
                        answer = ""
                        if solution_el:
                            sol_body = solution_el.query_selector('.lia-body-content, .lia-message-body-content')
                            answer = get_clean_text(sol_body)
                        
                        # Fallback to first reply if no accepted solution (only if not empty)
                        if not answer:
                            # Skip the first message (question)
                            all_messages = post_page.query_selector_all('.lia-component-message-view-widget-body')
                            if len(all_messages) > 1:
                                answer = get_clean_text(all_messages[1])
                        
                        post_page.close()
                        
                        if title and question_body and answer:
                            extracted_count += 1
                            with open(output_file, "a", encoding="utf-8") as f:
                                f.write(f"Question: {title}\n\n{question_body}\n\n")
                                f.write(f"Answer: {answer}\n\n")
                                f.write("-" * 50 + "\n\n")
                            print(f" -> Successfully extracted Q&A pair.")
                        else:
                            print(f" -> Incomplete content found. Skipping.")
                            
                    except Exception as e:
                        print(f" -> Error processing post: {e}")
                        try:
                            post_page.close()
                        except:
                            pass
                
                current_page += 1
                
        except Exception as e:
            print(f"\nAn error occurred during extraction:")
            traceback.print_exc()
        finally:
            browser.close()
            
    print(f"\nExtraction complete. Total pairs: {extracted_count}")
    print(f"Results saved to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract ServiceNow Forum Q&A pairs")
    parser.add_argument("--url", default="https://www.servicenow.com/community/grc-forum/bd-p/governance-risk-compliance-forum", help="Forum board URL")
    parser.add_argument("--amount", type=int, default=10, help="Number of pairs to extract. -1 for infinite.")
    parser.add_argument("--output", default="servicenow_qa.txt", help="Output text file")
    
    args = parser.parse_args()
    
    extract_servicenow_qa(args.url, args.amount, args.output)
