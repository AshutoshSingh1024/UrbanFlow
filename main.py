"""
UrbanFlow Portal — Dual Database Architecture (Open vs Resolved Issues)
- open_issues.db: Active/open issues queried for live maps and predictions
- resolved_issues.db: Archived resolved issues
"""
import math
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, List, Optional
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# ---------------------------------------------------------------------------
# Paths & Directories
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"

for d in (STATIC_DIR, DATA_DIR, UPLOAD_DIR):
    d.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Dual Database Configuration (SQLite)
# ---------------------------------------------------------------------------
OPEN_DB_URL = f"sqlite:///{DATA_DIR / 'open_issues.db'}"
RESOLVED_DB_URL = f"sqlite:///{DATA_DIR / 'resolved_issues.db'}"

engine_open = create_engine(OPEN_DB_URL, connect_args={"check_same_thread": False})
engine_resolved = create_engine(RESOLVED_DB_URL, connect_args={"check_same_thread": False})

SessionOpen = sessionmaker(autocommit=False, autoflush=False, bind=engine_open)
SessionResolved = sessionmaker(autocommit=False, autoflush=False, bind=engine_resolved)

Base = declarative_base()


class IssueModel(Base):
    __tablename__ = "issues"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex, index=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    category = Column(String, nullable=False, index=True)
    description = Column(String, default="")
    photo_url = Column(String, nullable=True)
    reported_by = Column(String, default="citizen")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="open", index=True)
    duplicate_count = Column(Integer, default=1)
    near = Column(String, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "lat": self.lat,
            "lng": self.lng,
            "category": self.category,
            "description": self.description,
            "photo_url": self.photo_url,
            "reported_by": self.reported_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "status": self.status,
            "duplicate_count": self.duplicate_count,
            "near": self.near,
        }


# Create tables in both databases
Base.metadata.create_all(bind=engine_open)
Base.metadata.create_all(bind=engine_resolved)


def get_open_db() -> Generator[Session, None, None]:
    db = SessionOpen()
    try:
        yield db
    finally:
        db.close()


def get_resolved_db() -> Generator[Session, None, None]:
    db = SessionResolved()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Spatial Utilities & Constants
# ---------------------------------------------------------------------------
VALID_CATEGORIES = {"pothole", "signal_failure", "waterlogging", "bus_breakdown"}

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Seed Data Generation (Populates open_issues.db only)
# ---------------------------------------------------------------------------
SEED_HUBS = [
    {"name": "Hinjawadi", "lat": 18.5908, "lng": 73.7392},
    {"name": "Katraj", "lat": 18.4574, "lng": 73.8677},
    {"name": "Swargate", "lat": 18.5018, "lng": 73.8636},
    {"name": "Shivajinagar", "lat": 18.5308, "lng": 73.8475},
    {"name": "Viman Nagar", "lat": 18.5679, "lng": 73.9143},
    {"name": "Kothrud", "lat": 18.5074, "lng": 73.8077},
]

SEED_DESCRIPTIONS = {
    "pothole": [
        "Deep pothole near the signal, buses swerving into oncoming lane.",
        "Road surface caved in after last week's rain.",
        "Cluster of small potholes slowing traffic to a crawl.",
    ],
    "signal_failure": [
        "Traffic signal stuck on red for 10+ minutes.",
        "Signal timer display is dead, junction running on guesswork.",
        "Signal cycling too fast for pedestrians to cross.",
    ],
    "waterlogging": [
        "Waterlogging after rain, ankle-deep at the crossing.",
        "Stormwater drain blocked, water spilling onto the carriageway.",
        "Underpass flooded, two-wheelers avoiding the route.",
    ],
    "bus_breakdown": [
        "PMPML bus stalled in the middle lane, blocking one side.",
        "Bus broken down at the stop, queue building up behind it.",
        "Bus stranded after a tyre burst near the junction.",
    ],
}

REPORTERS = ["citizen", "citizen", "citizen", "field_staff"]


def seed_database_if_empty():
    db = SessionOpen()
    try:
        if db.query(IssueModel).first() is None:
            rng = random.Random(42)
            seed_records = []
            for _ in range(18):
                hub = rng.choice(SEED_HUBS)
                category = rng.choice(list(VALID_CATEGORIES))
                lat = round(hub["lat"] + rng.uniform(-0.012, 0.012), 6)
                lng = round(hub["lng"] + rng.uniform(-0.012, 0.012), 6)
                issue = IssueModel(
                    lat=lat,
                    lng=lng,
                    category=category,
                    description=rng.choice(SEED_DESCRIPTIONS[category]),
                    photo_url=None,
                    reported_by=rng.choice(REPORTERS),
                    created_at=datetime.now(timezone.utc),
                    status="open",
                    duplicate_count=1,
                    near=hub["name"],
                )
                seed_records.append(issue)
            db.add_all(seed_records)
            db.commit()
    finally:
        db.close()


seed_database_if_empty()

# ---------------------------------------------------------------------------
# Corridors used by prediction engine
# ---------------------------------------------------------------------------
CORRIDORS = [
    {"id": "hinjawadi_wakad", "name": "Hinjawadi – Wakad Link Road",
     "coords": [[18.5908, 73.7392], [18.5993, 73.7649]], "base_load": 1.0},
    {"id": "hinjawadi_phase1", "name": "Hinjawadi Phase 1 Corridor",
     "coords": [[18.5908, 73.7392], [18.5975, 73.7280]], "base_load": 0.8},
    {"id": "katraj_bypass", "name": "Katraj Junction – Bypass",
     "coords": [[18.4574, 73.8677], [18.4650, 73.8590]], "base_load": 0.9},
    {"id": "swargate_shankarsheth", "name": "Swargate – Shankar Sheth Rd",
     "coords": [[18.5018, 73.8636], [18.5090, 73.8560]], "base_load": 0.85},
    {"id": "shivajinagar_fc", "name": "Shivajinagar – FC Road",
     "coords": [[18.5308, 73.8475], [18.5158, 73.8412]], "base_load": 0.6},
    {"id": "vimannagar_airport", "name": "Viman Nagar – Airport Road",
     "coords": [[18.5679, 73.9143], [18.5665, 73.8930]], "base_load": 0.7},
]


def midpoint(coords):
    lats = [c[0] for c in coords]
    lngs = [c[1] for c in coords]
    return sum(lats) / len(lats), sum(lngs) / len(lngs)


def is_peak_hour(ist_hour: int) -> bool:
    return (8 <= ist_hour <= 11) or (17 <= ist_hour <= 21)


# ---------------------------------------------------------------------------
# FastAPI Endpoints
# ---------------------------------------------------------------------------
app = FastAPI(title="UrbanFlow Portal")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/issues")
def get_issues(
    status: Optional[str] = None,
    open_db: Session = Depends(get_open_db),
    resolved_db: Session = Depends(get_resolved_db),
):
    """
    Returns open issues, resolved issues, or both based on the ?status parameter.
    Defaults to all open + resolved issues for frontend compatibility.
    """
    if status == "open":
        return [issue.to_dict() for issue in open_db.query(IssueModel).all()]
    if status == "resolved":
        return [issue.to_dict() for issue in resolved_db.query(IssueModel).all()]

    open_items = [issue.to_dict() for issue in open_db.query(IssueModel).all()]
    resolved_items = [issue.to_dict() for issue in resolved_db.query(IssueModel).all()]
    return open_items + resolved_items


@app.post("/api/issues")
async def create_issue(
    lat: float = Form(...),
    lng: float = Form(...),
    category: str = Form(...),
    description: str = Form(""),
    reported_by: str = Form("citizen"),
    photo: Optional[UploadFile] = File(None),
    open_db: Session = Depends(get_open_db),
):
    if category not in VALID_CATEGORIES:
        raise HTTPException(400, f"category must be one of {sorted(VALID_CATEGORIES)}")

    # Check for duplicate reports in the active database within 50m
    existing_open = open_db.query(IssueModel).filter(IssueModel.category == category).all()
    for existing in existing_open:
        if haversine_km(lat, lng, existing.lat, existing.lng) < 0.05:
            existing.duplicate_count += 1
            open_db.commit()
            open_db.refresh(existing)
            return {"merged_into": existing.id, "issue": existing.to_dict()}

    photo_url = None
    if photo is not None and photo.filename:
        ext = Path(photo.filename).suffix or ".jpg"
        fname = f"{uuid.uuid4().hex}{ext}"
        (UPLOAD_DIR / fname).write_bytes(await photo.read())
        photo_url = f"/uploads/{fname}"

    new_issue = IssueModel(
        lat=lat,
        lng=lng,
        category=category,
        description=description,
        photo_url=photo_url,
        reported_by=reported_by,
        created_at=datetime.now(timezone.utc),
        status="open",
        duplicate_count=1,
        near=None,
    )
    open_db.add(new_issue)
    open_db.commit()
    open_db.refresh(new_issue)
    return {"merged_into": None, "issue": new_issue.to_dict()}


@app.patch("/api/issues/{issue_id}/resolve")
def resolve_issue(
    issue_id: str,
    open_db: Session = Depends(get_open_db),
    resolved_db: Session = Depends(get_resolved_db),
):
    """
    Finds the issue in open_issues.db, copies it to resolved_issues.db,
    and removes it from open_issues.db.
    """
    open_issue = open_db.query(IssueModel).filter(IssueModel.id == issue_id).first()
    if not open_issue:
        # Check if already resolved
        already_resolved = resolved_db.query(IssueModel).filter(IssueModel.id == issue_id).first()
        if already_resolved:
            return already_resolved.to_dict()
        raise HTTPException(404, "issue not found in active database")

    # Create record in resolved database
    resolved_issue = IssueModel(
        id=open_issue.id,
        lat=open_issue.lat,
        lng=open_issue.lng,
        category=open_issue.category,
        description=open_issue.description,
        photo_url=open_issue.photo_url,
        reported_by=open_issue.reported_by,
        created_at=open_issue.created_at,
        resolved_at=datetime.now(timezone.utc),
        status="resolved",
        duplicate_count=open_issue.duplicate_count,
        near=open_issue.near,
    )
    resolved_db.add(resolved_issue)
    resolved_db.commit()
    resolved_db.refresh(resolved_issue)

    # Remove from open database
    open_db.delete(open_issue)
    open_db.commit()

    return resolved_issue.to_dict()


@app.get("/api/predictions")
def get_predictions(open_db: Session = Depends(get_open_db)):
    """Only open/unresolved issues from open_issues.db affect corridor risk."""
    open_issues = open_db.query(IssueModel).all()
    ist_hour = datetime.now(ZoneInfo("Asia/Kolkata")).hour
    peak = is_peak_hour(ist_hour)
    peak_factor = 1.6 if peak else 1.0

    results = []
    for corridor in CORRIDORS:
        mlat, mlng = midpoint(corridor["coords"])
        nearby = sum(
            1 for i in open_issues if haversine_km(mlat, mlng, i.lat, i.lng) < 1.2
        )
        incident_penalty = nearby * 0.45
        risk_score = corridor["base_load"] * peak_factor + incident_penalty

        if risk_score < 1.1:
            level = "low"
        elif risk_score < 2.0:
            level = "medium"
        else:
            level = "high"

        results.append(
            {
                **corridor,
                "risk_score": round(risk_score, 2),
                "level": level,
                "open_issues_nearby": nearby,
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "peak_hour": peak,
        "corridors": results,
    }


@app.get("/api/stats")
def get_stats(
    open_db: Session = Depends(get_open_db),
    resolved_db: Session = Depends(get_resolved_db),
):
    open_issues = open_db.query(IssueModel).all()
    resolved_count = resolved_db.query(IssueModel).count()

    by_category = {}
    for i in open_issues:
        by_category[i.category] = by_category.get(i.category, 0) + 1

    return {
        "total_open": len(open_issues),
        "total_resolved": resolved_count,
        "by_category": by_category,
    }