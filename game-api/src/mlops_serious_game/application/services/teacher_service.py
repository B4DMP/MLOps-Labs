from typing import Any

from sqlalchemy import delete, select

from mlops_serious_game.application.services.auth_service import hash_password
from mlops_serious_game.infrastructure.database import Campaign, Teacher, TeacherCampaign, get_session

_MIN_PASSWORD_LENGTH = 8


def _teacher_campaign_keys(session, teacher_id: int) -> list[str]:
    rows = session.execute(
        select(Campaign.campaign_key)
        .join(TeacherCampaign, TeacherCampaign.campaign_id == Campaign.id)
        .where(TeacherCampaign.teacher_id == teacher_id)
    ).all()
    return [r[0] for r in rows]


def _replace_campaign_assignments(session, teacher_id: int, campaign_keys: list[str]) -> list[str]:
    session.execute(delete(TeacherCampaign).where(TeacherCampaign.teacher_id == teacher_id))
    campaigns = session.scalars(
        select(Campaign).where(Campaign.campaign_key.in_(campaign_keys))
    ).all()
    for campaign in campaigns:
        session.add(TeacherCampaign(teacher_id=teacher_id, campaign_id=campaign.id))
    return [c.campaign_key for c in campaigns]


def list_teachers() -> list[dict[str, Any]]:
    with get_session() as session:
        teachers = session.scalars(select(Teacher)).all()
        return [
            {
                "id": t.id,
                "user_name": t.user_name,
                "campaign_keys": _teacher_campaign_keys(session, t.id),
            }
            for t in teachers
        ]


def create_teacher(user_name: str, password: str, campaign_keys: list[str]) -> dict[str, Any]:
    user_name = (user_name or "").strip()
    password = password or ""
    if not user_name or not password:
        raise ValueError("Name and password are required.")
    if len(password) < _MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long.")

    with get_session() as session:
        if session.scalar(select(Teacher).where(Teacher.user_name == user_name)) is not None:
            raise ValueError("A teacher with this name already exists.")

        teacher = Teacher(user_name=user_name, password_hash=hash_password(password))
        session.add(teacher)
        session.flush()

        assigned = _replace_campaign_assignments(session, teacher.id, campaign_keys or [])
        return {"id": teacher.id, "user_name": teacher.user_name, "campaign_keys": assigned}


def update_teacher_campaigns(teacher_id: int, campaign_keys: list[str]) -> dict[str, Any]:
    with get_session() as session:
        teacher = session.get(Teacher, teacher_id)
        if teacher is None:
            raise ValueError("Teacher not found.")
        assigned = _replace_campaign_assignments(session, teacher_id, campaign_keys or [])
        return {"id": teacher.id, "user_name": teacher.user_name, "campaign_keys": assigned}


def update_teacher_password(teacher_id: int, new_password: str) -> None:
    new_password = new_password or ""
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long.")
    with get_session() as session:
        teacher = session.get(Teacher, teacher_id)
        if teacher is None:
            raise ValueError("Teacher not found.")
        teacher.password_hash = hash_password(new_password)


def delete_teacher(teacher_id: int) -> None:
    with get_session() as session:
        session.execute(delete(Teacher).where(Teacher.id == teacher_id))


def get_teacher_campaign_keys(teacher_id: int) -> list[str]:
    with get_session() as session:
        return _teacher_campaign_keys(session, teacher_id)
