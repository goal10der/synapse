#!/bin/bash

# 1. Get Lat/Lon via a reliable GeoIP API (No D-Bus needed)
# Using jq to parse if you have it, otherwise we use grep/cut
loc=$(curl -s https://ipapi.co/latlong/)

if [ -n "$loc" ]; then
    # 2. Fetch weather using those specific coordinates
    curl -s "wttr.in/$loc?format=%c+%t"
else
    # Fallback to general city-based if API is down
    curl -s "wttr.in?format=%c+%t"
fi