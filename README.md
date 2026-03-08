# Face DTR – Facial Recognition Attendance System

A browser-based Daily Time Record (DTR) system that uses AI-powered facial recognition to log employee / student attendance – no server or backend required.

---

## Features

| Feature | Details |
|---|---|
| **Live face detection** | Real-time face detection overlay using a webcam |
| **Facial recognition** | Identifies registered users and auto-records attendance |
| **Time-In / Time-Out** | Alternates between Time-In and Time-Out on each scan |
| **Late detection** | Marks Time-In records as "Late" if scanned after 9:00 AM |
| **Admin panel** | Protected dashboard for HR / admins |
| **Face registration** | Capture 1–5 face samples per user for higher accuracy |
| **Attendance table** | Filter by date, name, or type; paginated results |
| **CSV export** | Download filtered attendance records as a spreadsheet |
| **Local storage** | All data stored in the browser – no account or server needed |

---

## Getting Started

### Prerequisites
- A modern browser with WebRTC support (Chrome, Edge, Firefox, Safari)
- A working webcam
- An internet connection (to load the AI models from CDN on first use)

### Running the app
Since the app uses `getUserMedia` (camera access), it must be served over **HTTPS** or **localhost**.

**Option A – VS Code Live Server** (recommended for local dev)
```bash
# Install the Live Server extension in VS Code, then right-click index.html → Open with Live Server
```

**Option B – Python HTTP server**
```bash
cd /path/to/Web-app-Face-DTR
python3 -m http.server 8080
# Open http://localhost:8080
```

**Option C – Node.js**
```bash
npx serve .
# Open the URL shown in the terminal
```

---

## Usage

### Attendance Page (`index.html`)
1. Open the app – the camera starts automatically.
2. Stand in front of the camera. Your face will be detected and outlined.
3. If recognised, attendance is logged and a confirmation card appears.
4. The left panel shows today's attendance list.

### Accessing the Admin Panel (hidden key)
The admin entry point is intentionally hidden from regular users.

**Method 1 – Keyboard shortcut (from the attendance page)**
> While the attendance page is open and focus is **not** in a text field, type the word **`admin`** on your keyboard.
> An admin login modal will appear.

**Method 2 – Direct URL**
> Navigate directly to `admin.html` (the URL is not linked anywhere on the user-facing page).

**Default admin password:** `FaceDTR@Admin2025`

You can change the password inside the Admin Panel → **Settings** tab.

### Registering a Face
1. Log in to the Admin Panel.
2. Go to the **Register Face** tab.
3. Enter the employee's name, department, and ID.
4. Click **📸 Capture Sample** 3–5 times (from slightly different angles).
5. Click **💾 Save & Register User**.

### Viewing Attendance
1. Log in to the Admin Panel.
2. Go to the **Attendance Records** tab.
3. Use the date / name / type filters to narrow results.
4. Click **⬇️ Export CSV** to download a spreadsheet.

---

## Project Structure

```
Web-app-Face-DTR/
├── index.html          User-facing attendance page
├── admin.html          Admin panel (login + dashboard)
├── css/
│   └── style.css       All styles
└── js/
    ├── utils.js        Shared utilities (storage, hashing, helpers)
    ├── attendance.js   Attendance page logic
    └── admin.js        Admin panel logic
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| UI | HTML5, CSS3 (custom properties, CSS Grid, Flexbox) |
| Face AI | [`@vladmandic/face-api`](https://github.com/vladmandic/face-api) (TensorFlow.js-based, loaded from CDN) |
| Models used | TinyFaceDetector, FaceLandmark68TinyNet, FaceRecognitionNet |
| Data storage | Browser `localStorage` (client-side, no server) |
| Auth hashing | Web Crypto API (SHA-256) |

---

## Security Notes

- Admin authentication uses SHA-256 password hashing via the Web Crypto API.
- All face descriptor data and attendance records are stored only in the user's browser (`localStorage`).
- For production use, replace `localStorage` with a proper backend database and server-side authentication.
- The admin URL (`admin.html`) is not linked from the public-facing page, and requires a password.

---

## License

MIT