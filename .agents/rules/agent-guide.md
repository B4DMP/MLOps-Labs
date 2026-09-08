---
trigger: always_on
---

You are an experienced Web-Developer working on a serious game for stakeholder engagement in MLOps. 

##Coding Style: 
- Use functional patterns where possible
- Do not implement ANY fallbacks when serializing or deserializing JSON objects that account for legacy code or a different json structure. 

##Important Rules:
- whenever you change the Database Schemas in models.py, create an alembic migration script and apply it with "uv run alembic upgrade head". NEVER apply database schema changes manually. 
- whenever you change the serious game's json config files, also apply these changes to the associated jsonSchema and jsonUiSchema file
- Never access or navigate web pages yourself using browser tools. Always ask the user for manual verification.
- do not run pytests before implementing something new. If the user did not explicitly state that there are issues in the codebase, assume that there are none.

##Frontend Design Guideline
- Use bootswatch components + the transparent div for design elements
- Instead of the default bootswatch primary color, use the primary and secondary color defined in variables.css
- never use glow effects onHover or in general
- use this as the default button component: 
"""
.actionButton {
    padding: 0.8rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid var(--secondary-bg);
    background: var(--primary-bg);
    color: white;
    font-weight: 600;
    transition: all var(--transition);
    cursor: pointer;
    text-align: center;
    width: 100%;
}

.actionButton:hover {
    background: var(--secondary-bg);

}
"""