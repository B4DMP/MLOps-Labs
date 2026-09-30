<div align="center">
  <h1>MLOps Labs</h1>
  <h3>a serious game that teaches stakeholder engagement using LLM stakeholder representatives</h3>
  <p class="tagline">This prototype was developed in the context of the bachelor's thesis "CHALLENGE: Collaborative Human-Agent Learning for Leveraging Engagement in Negotiated Governance of MLOps" at the Chair of Databases and Information Systems (i5) at RWTH Aachen University.
</p>
</div>

This repository is a fork of the [MLOps Serious Game simulation engine](https://github.com/neural-maze/mlops_serious_game-course).
</br>

## 🏗️ Project Structure

We rely on two separate applications:

```bash
.
├── game-api/     # Backend API containing the agentic layer and game logic (Python)
└── game-ui/      # Frontend UI for the game (Vite+React)
```

## 👔 Dataset

To impersonate stakeholder representatives with real-world knowledge, we populate their long-term memory with data from:
- practicioner sources (reddit, medium, blogs)
- scientific sources

Each stakeholder's sources are provided as text files in the `game-api\data\stakeholder_extraction_data` directory.

## 🔌 Communication Architecture & WebSocket Event Catalog

The application uses a unified architecture combining REST endpoints for request-response authentication/admin actions and a single, unified WebSocket connection (`/ws`) for all real-time game interactions.

### REST Endpoints
- `POST /api/auth/login`: Authenticate a player by email (admin and teacher accounts by name).
- `POST /api/auth/register`: Register new user or admin.
- `GET /api/admin/dashboard`: Fetch admin metrics & player progress (requires Admin JWT header).
- `POST /api/admin/campaigns`: Create campaign.
- `DELETE /api/admin/campaigns/{key}`: Delete campaign.

### WebSocket Event Catalog (`/ws`, authenticated by the player cookie)

| Direction | Event Name | Description | Payload Example |
| :--- | :--- | :--- | :--- |
| Client -> Server | `game:init` | Request initial metrics, stakeholders, phases | `{}` |
| Server -> Client | `game:init_data` | Initial static game configurations | `{ metrics: [...], stakeholders: [...], phases: [...] }` |
| Client -> Server | `game:progress_update` | Advance progression index | `{ index: 2, additional_data: [...] }` |
| Server -> Client | `game:progress_change` | Update client view state | `{ progression_index: 2, type: "briefing", content: {...} }` |
| Client -> Server | `chat:send_message` | User sends message in meeting | `{ message: "...", selectionmask: [true, false] }` |
| Server -> Client | `chat:message_received` | Stakeholder message response | `{ stakeholder_id: 0, message: "...", action_cards: [...] }` |
| Client -> Server | `game:state_request` | Advance challenge/phase & metrics | `{ phase_id: 0, challenge_id: 1, action_card: {...}, metric_values: [...] }` |
| Server -> Client | `game:state_update` | Challenge metrics update | `{ phase_id: 0, challenge_id: 1, metric_values: [...], metric_changes: {...} }` |
| Client/Server | `system:ping` / `system:pong` | Heartbeat keep-alive | `{ timestamp: 1700000000 }` |
| Server -> Client | `system:error` | Uniform error response | `{ code: "ERR_LANGGRAPH", message: "..." }` |

## 🚀 Getting Started

Find detailed setup and usage instructions in the [INSTALL_AND_USAGE.md](INSTALL_AND_USAGE.md) file.



## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.





