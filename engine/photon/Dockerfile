# Photon geocoder: there is no official image, so this wraps the release jar.
# The index is mounted at /photon (expects /photon/photon_data).
FROM eclipse-temurin:21-jre

ARG PHOTON_VERSION=1.3.0
ADD https://github.com/komoot/photon/releases/download/${PHOTON_VERSION}/photon-${PHOTON_VERSION}.jar /opt/photon.jar

WORKDIR /photon
ENV JAVA_OPTS="-Xmx1500m"
EXPOSE 2322
CMD ["sh", "-c", "exec java $JAVA_OPTS -jar /opt/photon.jar serve -data-dir /photon -listen-ip 0.0.0.0"]
