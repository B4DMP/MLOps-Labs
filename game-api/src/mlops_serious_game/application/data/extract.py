from pathlib import Path
from typing import Generator

from langchain_community.document_loaders import WebBaseLoader, WikipediaLoader
from langchain_core.documents import Document
from tqdm import tqdm

from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.config import settings

def get_extraction_generator(
    stakeholders: list[str],
) -> Generator[tuple[Stakeholder, list[Document]], None, None]:
    """Extract documents for a list of stakeholders, yielding one at a time.

    Args:
        stakeholders: A list of Stakeholder objects containing stakeholder information.

    Yields:
        tuple[Stakeholder, list[Document]]: A tuple containing the stakeholder object and a list of
            documents extracted for that stakeholder.
    """

    progress_bar = tqdm(
        stakeholders,
        desc="Extracting docs",
        unit="stakeholder",
        bar_format="{desc}: {percentage:3.0f}%|{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}] {postfix}",
        ncols=100,
        position=0,
        leave=True,
    )

    stakeholders_factory = StakeholderFactory()
    
    for s in progress_bar:
        stakeholder = stakeholders_factory.get_stakeholder(s)
        progress_bar.set_postfix_str(f"Stakeholder: {stakeholder.name}")

        stakeholder_docs = extract(stakeholder, settings.EXTRACTION_STAKEHOLDER_DATA_FILE)

        yield (stakeholder, stakeholder_docs)


def extract(
    stakeholder: Stakeholder, path: Path
)-> list[Document]:

    documents = []
    stakeholder_dir = path / stakeholder.id

    if not stakeholder_dir.exists() or not stakeholder_dir.is_dir():
        print(f"Skipping {stakeholder.name}: Directory '{stakeholder_dir}' not found.")
        return []

    for f in stakeholder_dir.iterdir():
        if f.is_file():
            try:
                metadata = {
                    "source": f.name,
                    "stakeholder_id": stakeholder.id,
                    "stakeholder_name": stakeholder.name
                }
                # Sanitize text by stripping NUL (0x00) bytes which cause PostgreSQL DataError exceptions
                content = f.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")
                documents.append(Document(page_content=content, metadata=metadata))
            except Exception as e:
                print(f"Skipping {f}: {e}")
    
    return documents
       
