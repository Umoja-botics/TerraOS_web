# terra-bridge — build ON TOP of a ROS2 base image
# Base must have rclpy + sensor_msgs + geometry_msgs already installed.
# Example: ros:humble-ros-base or a custom faucon image.
#
# Build:  docker build -t terra-bridge .
# Run:    docker run --network host \
#           -e ROBOT_ID=faucon-ugv-01 \
#           -e TERRA_API_URL=http://terra-api:4000 \
#           terra-bridge

FROM ros:humble-ros-base

WORKDIR /bridge

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Source ROS2 setup on container start
SHELL ["/bin/bash", "-c"]
RUN echo "source /opt/ros/humble/setup.bash" >> ~/.bashrc

EXPOSE 8100

CMD ["/bin/bash", "-c", "source /opt/ros/humble/setup.bash && uvicorn main:app --host 0.0.0.0 --port 8100"]
