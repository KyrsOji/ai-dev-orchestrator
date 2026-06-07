"""Matrix approval bridge (mock/dry-run implementation).

This package provides a lightweight bridge that routes approval requests
between Kafka topics and a Matrix room. For now the implementation is a
mock/dry-run version that prints Matrix posts and Kafka publishes to
stdout for testing.
"""
__version__ = "0.1.0"
__all__ = ["bridge"]
