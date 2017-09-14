#!/bin/sh

docker start $(docker ps -aq --filter name=container-seta-node)
