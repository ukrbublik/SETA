#!/bin/sh

docker stop $(docker ps -aq --filter name=container-seta-node)
