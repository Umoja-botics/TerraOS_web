---
name: project-faucon-ros2
description: Authoritative Faucon ROS2 topic names, ports, and message formats for TerraOS integration
metadata:
  type: project
---

Key facts derived from /home/klein/umoja_project/robotics/Faucon/docs/ and faucon_server source.

**Teleop:** IHM joystick → `/teleop/ihm/cmd_vel` (Twist). NOT `/faucon/ihm/cmd_vel` (bug corrected in bridge).

**E-STOP:** `/faucon/robot/estop` (std_msgs/Bool). Mode Manager also receives.

**Camera stream:** `web_video_server` on port **8080** (not the bridge port 8100).
URL format: `http://<host>:8080/stream?topic=/faucon/robot/camera/image`

**Mission topics:**
- UGV load: `/mission/load_path` (YAML: `{name, nav_mode: FOLLOW_WAYPOINTS|GOTO_WAYPOINT, waypoints: [{latitude, longitude}]}`)
- UGV cmd: `/mission/command` (String: START/PAUSE/RESUME/CANCEL)
- Brouette load: `/faucon/brouette/mission/load` (JSON: `{mission_id, waypoints}`)
- Brouette cmd: `/faucon/brouette/mission/command`
- Drone load: `/faucon/drone/mission/load` (JSON: `{mission_id, task: "follow_waypoints"|"inspection", waypoints}`)
- Drone cmd: `/faucon/drone/mission/command`

**Mode manager:** `/mode_manager/requests` (JSON: `{type: REQUEST_TELEOP|REQUEST_AUTO|MISSION_LOCK|MISSION_UNLOCK}`)

**System state:** `/faucon/system/mode` (String), `/faucon/system/health` (JSON: `{level, faults[]}`)

**Bridge endpoints (bridge → ROS2):**
- `POST /commands/mission/load` → `{agent_id, mission_id, payload}` → per-agent load topic
- `POST /commands/mission/command` → `{agent_id, command}` → agent_id='all' broadcasts to all
- `POST /commands/mode` → `{type}` → mode_manager
- `POST /commands/teleop` → `{linear, angular}` → /teleop/ihm/cmd_vel

**GPS datum:** `/gnss/datum` (latched). ENU conversion: service `/fromLLArray` (batch GPS→ENU). Web only deals in GPS lat/lon.
