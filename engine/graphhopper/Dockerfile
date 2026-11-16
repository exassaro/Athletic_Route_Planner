# GraphHopper for the Phase 3 "fewer main roads" spike. No official image is used;
# this wraps the release jar. Config and custom models are copied in; the graph
# cache is written to the mounted /data volume.
FROM eclipse-temurin:21-jre

ARG GH_VERSION=11.1
ADD https://github.com/graphhopper/graphhopper/releases/download/${GH_VERSION}/graphhopper-web-${GH_VERSION}.jar /opt/graphhopper.jar

COPY config.yml /opt/gh/config.yml
COPY custom_models /opt/gh/custom_models

WORKDIR /data
ENV JAVA_OPTS="-Xmx3g"
EXPOSE 8989
CMD ["sh", "-c", "exec java $JAVA_OPTS -Ddw.graphhopper.datareader.file=/osm/kerala.osm.pbf -Ddw.graphhopper.graph.location=/data/graph-cache -jar /opt/graphhopper.jar server /opt/gh/config.yml"]
