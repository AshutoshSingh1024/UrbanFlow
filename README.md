# UrbanFlow

**A unified web platform for reporting, tracking, and coordinating urban incidents across municipal departments.**

UrbanFlow brings citizen reports and departmental operations into a single map-driven interface. Incidents such as potholes, traffic signal failures, accidents, waterlogging, fires, sanitation problems, medical emergencies, and transit issues can be reported, reviewed, filtered, and resolved from one system.

The application is built around a simple idea: **everyone should be looking at the same city.**

---

## Features

### Interactive Incident Map

UrbanFlow uses an interactive Leaflet map to display incidents geographically.

Each incident can contain information such as:

- Category
- Location
- Locality
- Description
- Reported time
- Current status
- Reporting source
- Attached evidence

Open and resolved incidents can be viewed separately, with department-specific filtering available to authenticated users.

### Department-Based Operations

Different departments can work with incidents relevant to their responsibilities.

Supported departments include:

| Department | Handles |
|---|---|
| Traffic Police | Traffic signals, accidents |
| Road Maintenance | Potholes, waterlogging, open manholes |
| Fire & Rescue | Fires, building collapses |
| Emergency Medical Services | Medical emergencies |
| Solid Waste & Sanitation | Garbage, dead animals, open sewage |
| Transit Team | Bus breakdowns |
| Admin | City-wide monitoring and personnel management |

### Location-Aware Reporting

An incident can be reported by selecting a location on the map or using the browser's geolocation capabilities.

UrbanFlow resolves coordinates to configured Pune localities, giving reports a human-readable location rather than leaving users with a pair of numbers that only a GPS satellite could love.

The application includes locality coverage for areas including:

- Hinjawadi
- Katraj
- Swargate
- Shivajinagar
- Viman Nagar
- Kothrud
- Aundh
- Hadapsar
- Baner
- Koregaon Park
- Kalyani Nagar
- Wakad

### Photo Evidence

Citizens can attach photographs while reporting an incident.

Field personnel can also attach a resolution photograph when closing an incident. The original report and resolution evidence are kept as separate references.

### Authentication and Roles

UrbanFlow includes department-based user authentication.

Accounts contain information such as:

- Department
- Personnel ID
- Name
- Password hash
- Account creation timestamp

Personnel IDs use department-specific prefixes, making accounts easy to identify within the application.

### Municipal Notices

Departments can publish operational notices and advisories independently of individual incidents.

Notices support:

- Title
- Description
- Department
- Author
- Priority
- Timestamp

### English, Hindi and Marathi

The interface includes support for:

- English
- Hindi
- Marathi

Translation requests can be processed in batches and cached to reduce unnecessary requests.

### Dashboard and Analytics

The dashboard provides an overview of the city's reported incidents, including:

- Total incidents
- Open incidents
- Resolved incidents
- High and critical incident counts
- Incident category distribution
- Department alerts
- Incident tables
- Map-based incident visibility

The frontend periodically refreshes relevant information without requiring a full page reload.

---

## How It Works

At a high level, UrbanFlow connects a map-based frontend to a FastAPI backend that handles authentication, incident reporting, file uploads, notices, location processing, and incident management.

```text
                    +------------------+
                    |     Citizens     |
                    +--------+---------+
                             |
                      Report an incident
                             |
                             v
                    +------------------+
                    |    FastAPI API   |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
              v                             v
       +--------------+              +---------------+
       |   Application |              |    Uploads    |
       |     Data      |              |   & Evidence  |
       +------+-------+              +---------------+
              |
              v
      +-------------------+
      | Department Views  |
      | & City Dashboard  |
      +---------+---------+
                |
                v
        Review and Resolve
```

The frontend and backend are intentionally kept relatively simple. The frontend is served directly by FastAPI, so there is no separate frontend build system required.

---

## Project Structure

```text
UrbanFlow/
|
├── main.py
├── requirements.txt
|
├── data/
│   └── issues.json
|
├── uploads/
|
├── static/
│   ├── index.html
│   ├── app.js
│   └── style.css
|
├── start_windows.bat
├── start_mac.command
|
└── README.md
```

### Backend

`main.py` contains the FastAPI application and the core application logic, including authentication, incident management, notices, location handling, translation, file uploads, and startup data initialization.

### Frontend

The frontend is intentionally lightweight and uses:

- HTML
- CSS
- Vanilla JavaScript
- Leaflet
- Chart.js

There is no frontend framework or build pipeline. The static application is served directly by FastAPI.

---

## Running Locally

### Requirements

- Python 3.13+
- pip

### 1. Clone the repository

```bash
git clone https://github.com/AshutoshSingh1024/UrbanFlow.git
cd UrbanFlow
```

### 2. Create a virtual environment

Windows:

```bash
python -m venv .venv
.venv\Scripts\activate
```

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Start the server

```bash
uvicorn main:app --reload
```

Then open:

```text
http://localhost:8000
```

The application initializes its required local data when it starts.

---

## Technology

| Layer | Technology |
|---|---|
| Backend | FastAPI |
| Server | Uvicorn |
| Language | Python |
| Frontend | HTML / CSS / JavaScript |
| Mapping | Leaflet |
| Charts | Chart.js |
| Translation | deep-translator |
| Authentication | PBKDF2-HMAC-SHA256 |
| File Uploads | FastAPI UploadFile |

---

## Screenshots

Screenshots and additional visual documentation can be added here as the interface evolves.

---

## License

This project is currently distributed without a declared open-source license.
