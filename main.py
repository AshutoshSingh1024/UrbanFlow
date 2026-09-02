"""
UrbanFlow Portal — Enterprise RBAC, All-Issues Master View, Reverse Geocoding, 
Notices Broadcast, Dynamic Translation, Mobile PWA/CORS integration,
Transit & Logistics Layer, and Dynamic Traffic Flow Engine (BPR Capacity Degradation Model).
"""
import hashlib
import math
import os
import random
import secrets
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Generator, Optional

from deep_translator import GoogleTranslator
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Float, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# ---------------------------------------------------------------------------
# Directories & Database Connections
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"

for d in (STATIC_DIR, DATA_DIR, UPLOAD_DIR):
    d.mkdir(exist_ok=True)

OPEN_DB_URL = f"sqlite:///{DATA_DIR / 'open_issues.db'}"
RESOLVED_DB_URL = f"sqlite:///{DATA_DIR / 'resolved_issues.db'}"

engine_open = create_engine(OPEN_DB_URL, connect_args={"check_same_thread": False})
engine_resolved = create_engine(RESOLVED_DB_URL, connect_args={"check_same_thread": False})

SessionOpen = sessionmaker(autocommit=False, autoflush=False, bind=engine_open)
SessionResolved = sessionmaker(autocommit=False, autoflush=False, bind=engine_resolved)

Base = declarative_base()


# ---------------------------------------------------------------------------
# Password Security (Native PBKDF2-HMAC-SHA256)
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000,
    ).hex()
    return f"{salt}${pwd_hash}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    try:
        salt, expected_hash = stored_hash.split("$")
        computed_hash = hashlib.pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            salt.encode("utf-8"),
            100_000,
        ).hex()
        return secrets.compare_digest(computed_hash, expected_hash)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class UserModel(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    department = Column(String, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "department": self.department,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class IssueModel(Base):
    __tablename__ = "issues"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex, index=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    category = Column(String, nullable=False, index=True)
    description = Column(String, default="")
    photo_url = Column(String, nullable=True)
    resolved_photo_url = Column(String, nullable=True)
    resolved_by = Column(String, nullable=True)
    reported_by = Column(String, default="citizen")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="open", index=True)
    duplicate_count = Column(Integer, default=1)
    near = Column(String, nullable=True)

    def to_dict(self):
        created_iso = self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None
        resolved_iso = self.resolved_at.replace(tzinfo=timezone.utc).isoformat() if self.resolved_at else None

        return {
            "id": self.id,
            "lat": self.lat,
            "lng": self.lng,
            "category": self.category,
            "description": self.description,
            "photo_url": self.photo_url,
            "resolved_photo_url": self.resolved_photo_url,
            "resolved_by": self.resolved_by,
            "reported_by": self.reported_by,
            "created_at": created_iso,
            "resolved_at": resolved_iso,
            "status": self.status,
            "duplicate_count": self.duplicate_count,
            "near": self.near or "Pune Central",
        }


class NoticeModel(Base):
    __tablename__ = "notices"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    department = Column(String, nullable=False)
    posted_by = Column(String, nullable=False)
    priority = Column(String, default="standard")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "department": self.department,
            "posted_by": self.posted_by,
            "priority": self.priority,
            "created_at": self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None,
        }


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
# Locality Geocoding & Distance Calculation
# ---------------------------------------------------------------------------
PUNE_LOCALITIES = [
    {"name": "Hinjawadi", "lat": 18.5908, "lng": 73.7392},
    {"name": "Katraj", "lat": 18.4574, "lng": 73.8677},
    {"name": "Swargate", "lat": 18.5018, "lng": 73.8636},
    {"name": "Shivajinagar", "lat": 18.5308, "lng": 73.8475},
    {"name": "Viman Nagar", "lat": 18.5679, "lng": 73.9143},
    {"name": "Kothrud", "lat": 18.5074, "lng": 73.8077},
    {"name": "Aundh", "lat": 18.5580, "lng": 73.8074},
    {"name": "Hadapsar", "lat": 18.5089, "lng": 73.9259},
    {"name": "Baner", "lat": 18.5590, "lng": 73.7868},
    {"name": "Koregaon Park", "lat": 18.5362, "lng": 73.8940},
    {"name": "Kalyani Nagar", "lat": 18.5463, "lng": 73.9034},
    {"name": "Wakad", "lat": 18.5987, "lng": 73.7656},
]

def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    return 2 * r * math.asin(math.sqrt(a))

def resolve_locality_name(lat: float, lng: float) -> str:
    closest = min(PUNE_LOCALITIES, key=lambda loc: haversine_km(lat, lng, loc["lat"], loc["lng"]))
    dist = haversine_km(lat, lng, closest["lat"], closest["lng"])
    if dist <= 3.5:
        return closest["name"]
    return f"{closest['name']} Outskirts"


DEPT_PREFIXES = {
    "Admin": "ADM",
    "Traffic Police": "TRF",
    "Road Maintenance Crew": "RDM",
    "Fire & Rescue Services": "FIR",
    "Emergency Medical (EMS)": "EMS",
    "Solid Waste & Sanitation (SWM)": "SWM",
    "Transit Team": "TRN",
    "Citizen": "CTZ",
}

DEPARTMENT_CATEGORIES = {
    "Traffic Police": ["signal_failure", "accident"],
    "Road Maintenance Crew": ["pothole", "waterlogging", "open_manhole"],
    "Fire & Rescue Services": ["fire", "building_collapse"],
    "Emergency Medical (EMS)": ["medical_emergency"],
    "Solid Waste & Sanitation (SWM)": ["trash", "dead_animal", "open_sewage"],
    "Transit Team": ["bus_breakdown"],
}

VALID_CATEGORIES = {
    "signal_failure", "accident", "pothole", "waterlogging", "open_manhole",
    "fire", "building_collapse", "medical_emergency", "trash", "dead_animal",
    "open_sewage", "bus_breakdown",
}


def generate_next_user_id(department: str, db: Session) -> str:
    prefix = DEPT_PREFIXES.get(department, "USR")
    existing_users = db.query(UserModel).filter(UserModel.id.like(f"{prefix}%")).all()
    max_num = 0
    for u in existing_users:
        digits_part = u.id[len(prefix):]
        if digits_part.isdigit():
            val = int(digits_part)
            if val > max_num:
                max_num = val
    return f"{prefix}{str(max_num + 1).zfill(3)}"


@lru_cache(maxsize=4096)
def perform_translation(text: str, target_lang: str) -> str:
    if not text or not text.strip() or target_lang == "en":
        return text
    try:
        translated = GoogleTranslator(source="auto", target=target_lang).translate(text)
        return translated or text
    except Exception:
        return text


class BatchTranslateRequest(BaseModel):
    texts: list[str]
    target_lang: str


# ---------------------------------------------------------------------------
# Seeder
# ---------------------------------------------------------------------------
def seed_data_if_empty():
    db = SessionOpen()
    try:
        if db.query(UserModel).first() is None:
            all_department_accounts = [
                ("Admin", "City Command Lead", "admin123"),
                ("Traffic Police", "Inspector R. Shinde", "traffic123"),
                ("Road Maintenance Crew", "Eng. P. Deshmukh", "road123"),
                ("Fire & Rescue Services", "Chief Officer K. Kadam", "fire123"),
                ("Emergency Medical (EMS)", "Paramedic Lead V. Joshi", "ems123"),
                ("Solid Waste & Sanitation (SWM)", "Supervisor S. More", "clean123"),
                ("Transit Team", "Fleet Manager N. Pawar", "transit123"),
                ("Citizen", "Citizen Portal Demo", "citizen123"),
            ]
            for dept, name, raw_pass in all_department_accounts:
                user_id = generate_next_user_id(dept, db)
                hashed = hash_password(raw_pass)
                db.add(UserModel(id=user_id, name=name, department=dept, password_hash=hashed))
            db.commit()

        if db.query(NoticeModel).first() is None:
            demo_notices = [
                NoticeModel(
                    title="Heavy Monsoon Waterlogging Advisory",
                    content="Civic teams stationed with heavy pumps at Shivajinagar underpass. Commuters advised to divert via FC road.",
                    department="Road Maintenance Crew",
                    posted_by="Eng. P. Deshmukh (RDM001)",
                    priority="urgent",
                    created_at=datetime.now(timezone.utc),
                ),
                NoticeModel(
                    title="Katraj Bypass Night Resurfacing Schedule",
                    content="Lane 2 resurfacing scheduled tonight from 23:00 to 05:00. Expect single-lane diversions.",
                    department="Traffic Police",
                    posted_by="Inspector R. Shinde (TRF001)",
                    priority="standard",
                    created_at=datetime.now(timezone.utc),
                )
            ]
            db.add_all(demo_notices)
            db.commit()

        if db.query(IssueModel).first() is None:
            SEED_DESCRIPTIONS = {
                "signal_failure": "Signal stuck on amber at main junction. Heavy corridor gridlock.",
                "accident": "Two-wheeler collision blocking left lane. Officers required on scene.",
                "pothole": "Deep pothole causing axle damage. Asphalt crumbled after continuous rain.",
                "waterlogging": "Underpass submerged in 1.5 ft water. Drainage clogged.",
                "open_manhole": "Uncovered manhole opposite main market chamber.",
                "fire": "Rubbish heap fire near electrical transformer on avenue.",
                "building_collapse": "Compound wall collapsed into road carriageway.",
                "medical_emergency": "Elderly pedestrian collapsed near transit shelter.",
                "trash": "Overflowing waste container spreading onto active street.",
                "dead_animal": "Animal carcass located along central divider.",
                "open_sewage": "Sewage drain bubbling out across traffic lane.",
                "bus_breakdown": "PMPML bus stalled at bus stop, corridor choked.",
            }
            rng = random.Random(42)
            records = []
            for _ in range(25):
                hub = rng.choice(PUNE_LOCALITIES)
                cat = rng.choice(list(VALID_CATEGORIES))
                lat = round(hub["lat"] + rng.uniform(-0.012, 0.012), 6)
                lng = round(hub["lng"] + rng.uniform(-0.012, 0.012), 6)
                records.append(
                    IssueModel(
                        lat=lat,
                        lng=lng,
                        category=cat,
                        description=SEED_DESCRIPTIONS[cat],
                        reported_by=rng.choice(["citizen", "field_patrol", "ward_officer"]),
                        created_at=datetime.now(timezone.utc),
                        status="open",
                        duplicate_count=1,
                        near=resolve_locality_name(lat, lng),
                    )
                )
            db.add_all(records)
            db.commit()
    finally:
        db.close()

seed_data_if_empty()


# ---------------------------------------------------------------------------
# Dynamic Traffic Flow Engine (BPR Capacity Degradation Model)
# ---------------------------------------------------------------------------
PUNE_CORRIDORS = [
    {
        "id": "COR_01",
        "name": "Shivajinagar - Hinjawadi IT Corridor",
        "baseline_mins": 32.0,
        "capacity_vph": 4800,
        "localities": ["Shivajinagar", "Aundh", "Baner", "Wakad", "Hinjawadi"],
        "transit_routes": ["Bus Line 100", "Metro Line 3 Feeder"],
        "bypass_route": "Divert via Baner-Pashan Link Road to Wakad Flyover"
    },
    {
        "id": "COR_02",
        "name": "Swargate - Katraj Spine",
        "baseline_mins": 22.0,
        "capacity_vph": 3600,
        "localities": ["Swargate", "Katraj"],
        "transit_routes": ["BRTS Route 2", "PMPML Express"],
        "bypass_route": "Divert via Bibwewadi-Kondhwa Link to avoid main junction"
    },
    {
        "id": "COR_03",
        "name": "Shivajinagar - Viman Nagar / Airport",
        "baseline_mins": 26.0,
        "capacity_vph": 4200,
        "localities": ["Shivajinagar", "Koregaon Park", "Kalyani Nagar", "Viman Nagar"],
        "transit_routes": ["Airport Shuttles", "Bus Line 204"],
        "bypass_route": "Divert via Sangamwadi BRT road & Bund Garden link"
    }
]

# Physical capacity reduction factor per incident type (fraction of road capacity choked)
INCIDENT_CAPACITY_IMPACT = {
    "accident": 0.35,          # Takes down ~1 lane
    "building_collapse": 0.60, # Major arterial choke
    "fire": 0.45,
    "waterlogging": 0.40,
    "bus_breakdown": 0.25,
    "signal_failure": 0.20,
    "open_manhole": 0.10,
    "pothole": 0.04,           # Minor braking speed drop
    "open_sewage": 0.08,
    "trash": 0.03,
    "dead_animal": 0.05,
}

HOURLY_DEMAND_CURVE = {
    0: 0.12, 1: 0.08, 2: 0.05, 3: 0.05, 4: 0.08, 5: 0.18,
    6: 0.35, 7: 0.60, 8: 0.88, 9: 0.98, 10: 0.92, 11: 0.78,
    12: 0.70, 13: 0.68, 14: 0.72, 15: 0.78, 16: 0.85, 17: 0.95,
    18: 1.02, 19: 0.98, 20: 0.85, 21: 0.65, 22: 0.45, 23: 0.25
}


# ---------------------------------------------------------------------------
# FastAPI Application & Endpoints
# ---------------------------------------------------------------------------
app = FastAPI(title="UrbanFlow Command Portal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")


@app.get("/manifest.json")
def manifest():
    return FileResponse(STATIC_DIR / "manifest.json", media_type="application/json")


@app.post("/api/translate/batch")
def batch_translate(req: BatchTranslateRequest):
    target = req.target_lang.lower().strip()
    if target not in ["en", "hi", "mr"]:
        target = "en"

    results = {}
    for text in req.texts:
        clean = text.strip()
        if clean:
            results[clean] = perform_translation(clean, target)
        else:
            results[text] = text

    return {"translations": results, "target_lang": target}


@app.post("/api/auth/login")
def login(
    user_id: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_open_db),
):
    user_id = user_id.strip().upper()
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(401, "Invalid User ID or Password")
    return {"authenticated": True, "user": user.to_dict()}


@app.get("/api/auth/preview-id")
def preview_id(department: str, db: Session = Depends(get_open_db)):
    if department not in DEPT_PREFIXES:
        raise HTTPException(400, "Invalid department chosen")
    return {"suggested_id": generate_next_user_id(department, db)}


@app.post("/api/auth/register-staff")
def register_staff(
    name: str = Form(...),
    department: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_open_db),
):
    if department not in DEPT_PREFIXES:
        raise HTTPException(400, f"Department must be one of: {list(DEPT_PREFIXES.keys())}")
    if len(password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters long")

    user_id = generate_next_user_id(department, db)
    hashed_pwd = hash_password(password)
    new_user = UserModel(
        id=user_id,
        name=name.strip(),
        department=department,
        password_hash=hashed_pwd,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"success": True, "user_id": new_user.id, "name": new_user.name, "department": new_user.department}


@app.get("/api/notices")
def get_notices(open_db: Session = Depends(get_open_db)):
    notices = open_db.query(NoticeModel).order_by(NoticeModel.created_at.desc()).all()
    return [n.to_dict() for n in notices]


@app.post("/api/notices")
def create_notice(
    title: str = Form(...),
    content: str = Form(...),
    department: str = Form(...),
    posted_by: str = Form(...),
    priority: str = Form("standard"),
    open_db: Session = Depends(get_open_db),
):
    if department == "Citizen":
        raise HTTPException(403, "Public users are not authorized to publish municipal notices.")

    notice = NoticeModel(
        title=title.strip(),
        content=content.strip(),
        department=department,
        posted_by=posted_by,
        priority=priority,
        created_at=datetime.now(timezone.utc),
    )
    open_db.add(notice)
    open_db.commit()
    open_db.refresh(notice)
    return notice.to_dict()


@app.get("/api/geocode/reverse")
def reverse_geocode(lat: float, lng: float):
    locality = resolve_locality_name(lat, lng)
    return {"locality": locality, "lat": lat, "lng": lng}


@app.get("/api/issues")
def get_issues(
    status: Optional[str] = None,
    department: Optional[str] = None,
    open_db: Session = Depends(get_open_db),
    resolved_db: Session = Depends(get_resolved_db),
):
    open_q = open_db.query(IssueModel)
    resolved_q = resolved_db.query(IssueModel)

    if department and department not in ["Admin", "Citizen"]:
        allowed_categories = DEPARTMENT_CATEGORIES.get(department, [])
        open_q = open_q.filter(IssueModel.category.in_(allowed_categories))
        resolved_q = resolved_q.filter(IssueModel.category.in_(allowed_categories))

    if status == "open":
        return [i.to_dict() for i in open_q.all()]
    if status == "resolved":
        return [i.to_dict() for i in resolved_q.all()]

    return [i.to_dict() for i in open_q.all()] + [i.to_dict() for i in resolved_q.all()]


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
        raise HTTPException(400, "Invalid category")

    photo_url = None
    if photo is not None and photo.filename:
        ext = Path(photo.filename).suffix or ".jpg"
        fname = f"{uuid.uuid4().hex}{ext}"
        (UPLOAD_DIR / fname).write_bytes(await photo.read())
        photo_url = f"/uploads/{fname}"

    locality = resolve_locality_name(lat, lng)

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
        near=locality,
    )
    open_db.add(new_issue)
    open_db.commit()
    open_db.refresh(new_issue)
    return {"merged_into": None, "issue": new_issue.to_dict()}


@app.post("/api/issues/{issue_id}/resolve")
async def resolve_issue(
    issue_id: str,
    resolved_by: str = Form(...),
    resolution_photo: UploadFile = File(...),
    open_db: Session = Depends(get_open_db),
    resolved_db: Session = Depends(get_resolved_db),
):
    if not resolution_photo or not resolution_photo.filename:
        raise HTTPException(400, "Compulsory on-site proof photo is required to resolve this alert.")

    open_issue = open_db.query(IssueModel).filter(IssueModel.id == issue_id).first()
    if not open_issue:
        raise HTTPException(404, "Issue not found in active database.")

    ext = Path(resolution_photo.filename).suffix or ".jpg"
    fname = f"resolved_{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / fname).write_bytes(await resolution_photo.read())
    resolved_photo_url = f"/uploads/{fname}"

    resolved_issue = IssueModel(
        id=open_issue.id,
        lat=open_issue.lat,
        lng=open_issue.lng,
        category=open_issue.category,
        description=open_issue.description,
        photo_url=open_issue.photo_url,
        resolved_photo_url=resolved_photo_url,
        resolved_by=resolved_by,
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

    open_db.delete(open_issue)
    open_db.commit()

    return resolved_issue.to_dict()


@app.get("/api/stats")
def get_stats(
    department: Optional[str] = None,
    open_db: Session = Depends(get_open_db),
    resolved_db: Session = Depends(get_resolved_db),
):
    open_q = open_db.query(IssueModel)
    resolved_q = resolved_db.query(IssueModel)

    if department and department not in ["Admin", "Citizen"]:
        allowed_categories = DEPARTMENT_CATEGORIES.get(department, [])
        open_q = open_q.filter(IssueModel.category.in_(allowed_categories))
        resolved_q = resolved_q.filter(IssueModel.category.in_(allowed_categories))

    open_issues = open_q.all()
    resolved_count = resolved_q.count()

    by_category = {}
    for i in open_issues:
        by_category[i.category] = by_category.get(i.category, 0) + 1

    return {
        "total_open": len(open_issues),
        "total_resolved": resolved_count,
        "by_category": by_category,
    }


# ---------------------------------------------------------------------------
# Transit & Predictive Analytics API Endpoint (Dynamic BPR Model)
# ---------------------------------------------------------------------------
@app.get("/api/analytics/corridors")
def get_corridor_analytics(open_db: Session = Depends(get_open_db)):
    current_hour = datetime.now().hour
    base_demand_ratio = HOURLY_DEMAND_CURVE.get(current_hour, 0.70)
    is_peak = base_demand_ratio >= 0.88
    phf = round(0.70 + (base_demand_ratio * 0.24), 2)

    active_issues = open_db.query(IssueModel).filter(IssueModel.status == "open").all()
    corridor_reports = []

    for cor in PUNE_CORRIDORS:
        matching = [i for i in active_issues if i.near in cor["localities"]]
        
        total_choke = sum(INCIDENT_CAPACITY_IMPACT.get(i.category, 0.05) for i in matching)
        effective_capacity_factor = max(0.28, 1.0 - min(0.72, total_choke))
        effective_capacity = cor["capacity_vph"] * effective_capacity_factor
        
        current_volume = cor["capacity_vph"] * base_demand_ratio
        
        vc_ratio = current_volume / effective_capacity
        alpha = 0.15
        beta = 3.5
        
        predicted_travel_time = cor["baseline_mins"] * (1.0 + alpha * (vc_ratio ** beta))
        predicted_travel_time = round(min(cor["baseline_mins"] * 2.6, predicted_travel_time), 1)
        delay_added = round(max(0.0, predicted_travel_time - cor["baseline_mins"]), 1)
        
        throughput_pct = round(max(20, min(100, (cor["baseline_mins"] / predicted_travel_time) * 100)))
        
        transit_bottleneck = any(i.category in ["bus_breakdown", "accident", "waterlogging", "signal_failure"] for i in matching)
        
        if delay_added >= 15.0:
            reroute_msg = cor["bypass_route"]
        elif delay_added >= 6.0:
            reroute_msg = f"Moderate slow-down. Stay in main lanes, avoid side kerbs near {matching[0].near if matching else 'junctions'}."
        else:
            reroute_msg = "Corridor operating at nominal speeds. No detour required."

        corridor_reports.append({
            "corridor_id": cor["id"],
            "name": cor["name"],
            "baseline_mins": cor["baseline_mins"],
            "predicted_mins": predicted_travel_time,
            "delay_added_mins": delay_added,
            "throughput_pct": throughput_pct,
            "incident_count": len(matching),
            "transit_routes": cor["transit_routes"],
            "transit_bottleneck": transit_bottleneck,
            "reroute_advisory": reroute_msg,
            "peak_hour_factor": phf,
            "is_peak": is_peak,
        })

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "peak_hour_factor": phf,
        "network_status": "Peak Period Grid Load" if is_peak else "Off-Peak Regulated Flow",
        "corridors": corridor_reports
    }