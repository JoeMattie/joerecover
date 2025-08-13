#!/usr/bin/env python3
"""
Demo API server for testing the worker binary.
This simulates the API endpoints that the worker expects.

Run with: python3 demo_server.py
Then test with: ./target/debug/worker --api-url http://localhost:8080 --worker-id test_worker
"""

from flask import Flask, request, jsonify
from dataclasses import dataclass, asdict
from typing import Optional, Dict, List
import time
import threading
import queue
import uuid

app = Flask(__name__)


@dataclass
class WorkPacket:
    id: str
    token_content: str
    skip: int
    stop_at: Optional[int]


@dataclass
class WorkStatus:
    work_id: str
    processed: int
    found: int
    rate: float
    completed: bool
    error: Optional[str]


# Global state
work_queue = queue.Queue()
active_work: Dict[str, WorkPacket] = {}
work_status: Dict[str, List[WorkStatus]] = {}
work_lock = threading.Lock()


def create_sample_work():
    """Create some sample work packets for testing"""
    sample_work = [
        WorkPacket(
            id=str(uuid.uuid4()),
            token_content="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about\nabout abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon",
            skip=0,
            stop_at=1000,
        ),
        WorkPacket(
            id=str(uuid.uuid4()),
            token_content="zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong\nzoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wine",
            skip=0,
            stop_at=500,
        ),
        WorkPacket(
            id=str(uuid.uuid4()),
            token_content="[len:4] [first:b] [last:y]\n[len:5] abandon abandon",
            skip=0,
            stop_at=2000,
        ),
    ]

    for work in sample_work:
        work_queue.put(work)

    print(f"🚀 Created {len(sample_work)} sample work packets")


@app.route("/get_work", methods=["POST"])
def get_work():
    """Get work endpoint - returns work packet or 204 if none available"""
    try:
        worker_data = request.get_json()
        worker_id = worker_data.get("worker_id", "unknown")

        print(f"📨 Worker {worker_id} requesting work...")

        try:
            # Try to get work from queue (non-blocking)
            work_packet = work_queue.get_nowait()

            with work_lock:
                active_work[work_packet.id] = work_packet
                work_status[work_packet.id] = []

            print(f"✅ Assigned work {work_packet.id} to worker {worker_id}")
            print(f"   Content preview: {work_packet.token_content[:50]}...")
            print(f"   Skip: {work_packet.skip}, Stop at: {work_packet.stop_at}")

            return jsonify(asdict(work_packet))

        except queue.Empty:
            print(f"❌ No work available for worker {worker_id}")
            return "", 204  # No Content

    except Exception as e:
        print(f"❌ Error in get_work: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/work_status", methods=["POST"])
def update_work_status():
    """Work status update endpoint"""
    try:
        status_data = request.get_json()

        # Parse the status update
        status = WorkStatus(
            work_id=status_data["work_id"],
            processed=status_data["processed"],
            found=status_data["found"],
            rate=status_data["rate"],
            completed=status_data["completed"],
            error=status_data.get("error"),
        )

        with work_lock:
            if status.work_id in work_status:
                work_status[status.work_id].append(status)

                # Remove from active work if completed
                if status.completed and status.work_id in active_work:
                    del active_work[status.work_id]

        # Print status update
        if status.error:
            print(f"❌ Work {status.work_id}: ERROR - {status.error}")
        elif status.completed:
            print(
                f"✅ Work {status.work_id}: COMPLETED - {status.processed} processed, {status.found} found"
            )
        else:
            print(
                f"📊 Work {status.work_id}: {status.processed} processed, {status.found} found, {status.rate:.0f}/sec"
            )

        return jsonify({"status": "ok"})

    except Exception as e:
        print(f"❌ Error in work_status: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/status", methods=["GET"])
def server_status():
    """Get server status - useful for monitoring"""
    with work_lock:
        return jsonify(
            {
                "pending_work": work_queue.qsize(),
                "active_work": len(active_work),
                "completed_work": len(
                    [w for w in work_status.keys() if w not in active_work]
                ),
                "active_work_ids": list(active_work.keys()),
                "timestamp": time.time(),
            }
        )


@app.route("/debug/work_status/<work_id>", methods=["GET"])
def get_work_debug(work_id):
    """Debug endpoint to see all status updates for a work packet"""
    with work_lock:
        if work_id in work_status:
            return jsonify(
                {
                    "work_id": work_id,
                    "status_updates": [asdict(s) for s in work_status[work_id]],
                    "is_active": work_id in active_work,
                }
            )
        else:
            return jsonify({"error": "Work ID not found"}), 404


if __name__ == "__main__":
    print("🚀 Starting demo API server...")
    print("   Endpoints:")
    print("   POST /get_work - Get work packet")
    print("   POST /work_status - Update work status")
    print("   GET /status - Server status")
    print("   GET /debug/work_status/<id> - Debug work status")
    print()

    # Create sample work
    create_sample_work()

    print()
    print("🧪 To test with the worker:")
    print("   cargo build --bin worker")
    print(
        "   ./target/debug/worker --api-url http://localhost:8080 --worker-id test_worker"
    )
    print()
    print("📊 Monitor status:")
    print("   curl http://localhost:8080/status")
    print()

    app.run(host="0.0.0.0", port=8080, debug=True)
