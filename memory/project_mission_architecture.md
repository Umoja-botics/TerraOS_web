---
name: project-mission-architecture
description: TerraOS mission flow — profiles defined in Missions page, launched from Dashboard
metadata:
  type: project
---

Mission flow is split into two pages by design:

**Missions page** (`/missions`) = profile manager
- Create profiles: name, robot, navMode (FOLLOW_WAYPOINTS / GOTO_WAYPOINT), agents (ugv/brouette/drone) each with a path
- Profiles saved to DB as IDLE status
- History (non-IDLE missions) shown in a second section
- No START/PAUSE/ABORT controls here

**Dashboard** = launch control
- MissionPanel widget shows a dropdown of IDLE profiles for the selected robot
- Selecting a profile sets missionStore to READY phase
- START calls `POST /missions/:id/start` → API dispatches load + START to each agent's bridge endpoint
- PAUSE / RESUME / CANCEL use dedicated endpoints (`/pause`, `/resume`, `/abort`)

**Why:** Separates "mission definition" from "mission execution" so operators can't accidentally start and cancel in the same flow.

**How to apply:** When adding mission features, keep definition logic in Missions page and execution controls in MissionPanel/Dashboard only.

See [[project-faucon-ros2]] for the underlying ROS2 topics used during dispatch.
