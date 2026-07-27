import argparse
import time
import sys
import random
from playwright.sync_api import sync_playwright

def get_clean_text(locator):
    """Extracts text content from a locator and cleans it."""
    if locator.count() == 0:
        return ""
    
    # We extract text from paragraphs and headers to avoid metadata/buttons
    # This is a general approach for Shreddit (Reddit's modern UI)
    try:
        text = locator.evaluate('''el => {
            const paragraphs = el.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
            if (paragraphs.length > 0) {
                return Array.from(paragraphs).map(p => p.innerText.trim()).filter(t => t !== "").join('\\n\\n');
            }
            return el.innerText.trim();
        }''')
        return text
    except Exception as e:
        print(f"Error cleaning text: {e}")
        return ""

def safe_goto(page, url, timeout=30000, retries=3):
    """Navigates to a URL with retries for network errors."""
    for i in range(retries):
        try:
            response = page.goto(url, timeout=timeout, wait_until="load")
            if response and response.status < 400:
                return True
            print(f" -> Warning: Attempt {i+1} for {url} returned status {response.status if response else 'None'}")
        except Exception as e:
            print(f" -> Warning: Attempt {i+1} for {url} failed: {e}")
        
        # Exponential backoff
        wait_time = (2 ** i) + random.random()
        time.sleep(wait_time)
    
    return False

def extract_reddit_qa(url, amount=-1, output_file="reddit_qa.txt"):
    """
    Extracts Q&A pairs from a subreddit.
    Question = Post Title + Body
    Answer = Most relevant (top) comment
    """
    if not url.endswith('/new/'):
        if url.endswith('/'):
            url += 'new/'
        else:
            url += '/new/'
            
    print(f"Starting Reddit extraction from {url}...")
    
    with sync_playwright() as p:
        # Using Firefox as requested by the user
        print("Launching Firefox...")
        browser = p.firefox.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0"
        )
        page = context.new_page()
        
        print(f"Navigating to {url}...")
        try:
            if not safe_goto(page, url):
                print(f"Error: Could not load subreddit {url} after retries.")
                browser.close()
                return
            # Wait for posts to load. 'shreddit-post' is the modern Reddit tag for posts.
            page.wait_for_selector('shreddit-post', timeout=30000)
        except Exception as e:
            print(f"Error loading subreddit: {e}")
            browser.close()
            return

        processed_urls = set()
        extracted_count = 0
        scroll_retries = 0
        
        mode = "infinite" if amount == -1 else f"target: {amount}"
        print(f"Starting extraction loop (mode: {mode}). Press Ctrl+C to stop anytime.")
        
        # Clear/Create the file
        with open(output_file, "w", encoding="utf-8") as f:
            f.write("")
            
        try:
            while amount == -1 or extracted_count < amount:
                # Find all posts on the page
                posts = page.query_selector_all('shreddit-post')
                new_posts = []
                
                for post in posts:
                    # Check if post has at least one answer
                    comment_count_attr = post.get_attribute('comment-count')
                    comment_count = int(comment_count_attr) if comment_count_attr and comment_count_attr.isdigit() else 0
                    
                    if comment_count > 0:
                        permalink = post.get_attribute('permalink')
                        if permalink:
                            full_url = "https://www.reddit.com" + permalink
                            if full_url not in processed_urls:
                                new_posts.append(full_url)
                
                if not new_posts:
                    print("No new posts with comments found. Scrolling...")
                    page.evaluate("window.scrollBy(0, 1000)")
                    time.sleep(2)
                    scroll_retries += 1
                    if scroll_retries >= 100:
                        print("Reached limit of scrolling without new content. Stopping.")
                        break
                    continue
                else:
                    scroll_retries = 0
                
                print(f"Found {len(new_posts)} new posts to process.")
                
                for post_url in new_posts:
                    if amount != -1 and extracted_count >= amount:
                        break
                    
                    processed_urls.add(post_url)
                    print(f"Processing post [{extracted_count+1}]: {post_url}")
                    
                    # Random delay to avoid bot detection
                    time.sleep(random.uniform(2, 5))
                    
                    try:
                        # Open post in a new page
                        post_page = context.new_page()
                        if not safe_goto(post_page, post_url):
                             print(f" -> Error: Could not load post {post_url}. Skipping.")
                             post_page.close()
                             continue
                        
                        # Wait for the post content
                        try:
                            post_page.wait_for_selector('shreddit-post', timeout=15000)
                        except:
                            print(f" -> Warning: shreddit-post not found on {post_url}. Checking for blockers...")
                            # Check for NSFW or login walls if necessary here
                            post_page.close()
                            continue
                        
                        # Extract Question (Title + Body)
                        post_el = post_page.locator('shreddit-post').first
                        title = post_page.locator('h1[slot="title"]').inner_text().strip() if post_page.locator('h1[slot="title"]').count() > 0 else "No Title"
                        body = get_clean_text(post_page.locator('div[slot="text-body"]'))
                        
                        question = f"{title}\n\n{body}".strip()
                        
                        # Extract Answer (Top Comment)
                        # We try to skip Automoderator or Moderator comments
                        comments = post_page.locator('shreddit-comment')
                        answer = ""
                        for i in range(min(5, comments.count())):
                            comment_loc = comments.nth(i)
                            author = comment_loc.get_attribute('author')
                            if author and author.lower() in ['automoderator', 'mod', 'moderator']:
                                continue
                            
                            potential_answer = get_clean_text(comment_loc)
                            if potential_answer and len(potential_answer) > 20: 
                                answer = potential_answer
                                break
                        
                        if not answer and comments.count() > 0:
                            # Fallback to first comment if no non-mod comment found
                            answer = get_clean_text(comments.first)
                        
                        post_page.close()
                        
                        if question and answer:
                            extracted_count += 1
                            # Append to file
                            with open(output_file, "a", encoding="utf-8") as f:
                                f.write(f"Question: {question}\n\n")
                                f.write(f"Answer: {answer}\n\n")
                                f.write("-" * 50 + "\n\n")
                            print(f" -> Successfully extracted Q&A pair.")
                        else:
                            print(f" -> Could not find question or answer content. Skipping.")
                            
                    except Exception as e:
                        print(f" -> Error processing post {post_url}: {e}")
                        try:
                            post_page.close()
                        except:
                            pass
                            
        except KeyboardInterrupt:
            print("\nExtraction interrupted by user.")
        except Exception as e:
            print(f"\nAn error occurred during extraction: {e}")
        finally:
            browser.close()
            
    print(f"\nExtraction complete. Total pairs: {extracted_count}")
    print(f"Results saved to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract Reddit Q&A pairs")
    parser.add_argument("--url", required=True, help="Subreddit URL (e.g., https://www.reddit.com/r/learnpython/)")
    parser.add_argument("--amount", type=int, default=10, help="Number of pairs to extract. -1 for infinite.")
    parser.add_argument("--output", default="reddit_qa.txt", help="Output text file")
    
    args = parser.parse_args()
    
    extract_reddit_qa(args.url, args.amount, args.output)
