Kafka client dependency

This project uses kafka-python for a persistent Kafka consumer when a Java-style `KAFKA_CLIENT_CONFIG` is not used. If kafka-console-consumer/producer CLI tools are not available in PATH, install the Python client:

pip3 install -r requirements.txt

Or install kafka-python directly:

pip3 install kafka-python

Note: If your Kafka setup uses Java keystore/truststore (mTLS) and a `KAFKA_CLIENT_CONFIG` properties file, the service will prefer the kafka-console-consumer CLI (Java client) so the Java keystore configuration can be used as-is.
