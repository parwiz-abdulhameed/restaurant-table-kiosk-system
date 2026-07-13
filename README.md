# 🍽️ Restaurant Table Kiosk System


![Admin updates order statuses, customer tracks live without refresh, and checks bill from top-right](restaurant-table-kiosk-system/Pi7_Gif%20(1).gif)


A portable, modern, and lightweight **Self-Service Restaurant Kiosk & Management System** designed to provide a complete digital ordering experience for restaurants.

The system allows customers to browse digital menus, place orders, track order status, and request assistance through restaurant kiosks, tablets, or mobile devices.

Restaurant staff can manage products, categories, tables, orders, reports, and kiosk settings through a powerful administration dashboard.

🌐 **No Internet Required:**  
The system works completely over a local network (LAN). Kiosk devices and administrator panels communicate instantly within the restaurant environment.

⚡ **No Docker Required:**  
The application is lightweight and can be started directly with Node.js on Windows environments.

---

# ✨ Features

## 👨‍💼 Admin Dashboard

* **Product Management**
  - Add, update, and delete products.
  - Manage product images and descriptions.

* **Category Management**
  - Create and organize menu categories.

* **Table Management**
  - Create restaurant tables and generate kiosk links dynamically.

* **Real-Time Order Tracking**
  - Receive instant order notifications using WebSocket communication.

* **Advanced Reports**
  - View sales statistics and export performance insights.
  - Generate PDF reports directly from the administration panel.

* **Kiosk Customization**
  - Upload restaurant branding / logo.
  - Change dynamic background images and loop videos.

* **Secure Authentication**
  - User login system.
  - Secure password reset functionality.

---

# 🖥️ Kiosk System

* Interactive digital menu with fluid navigation.
* Product images and detailed descriptions.
* Instant ordering processed through the local network.
* Real-time order status tracking for customers.
* One-click "Call Waiter" assistance button.
* Support for QR payment simulation and integrated external payment system setups.
* Fully responsive interface optimized for:
  - Dedicated restaurant kiosks
  - Touch screen monitors
  - Tablets
  - Mobile smartphones

---

# 🚀 Installation

## 1. Clone Repository
```powershell
git clone https://github.com
cd restaurant-table-kiosk-system-main
```


## 2. Requirements

Open your project folder in your code editor (e.g., Visual Studio Code) and ensure **Node.js v18.x or newer** is already installed on your system.

Verify your development environment by running the following commands directly inside the editor terminal (PowerShell):
```powershell
node -v
npm -v
```



⚠️ Important: After cloning, you may find that the source files are inside a subfolder with the same name (restaurant-table-kiosk-system-main/restaurant-table-kiosk-system-main). If so, move into that subfolder before continuing:

```powershell
cd restaurant-table-kiosk-system-main

```



## 3. Create Required Folders
Open PowerShell inside the project directory and execute the following commands to securely generate the target directories:
```powershell

mkdir public\img -Force
mkdir public\videos -Force
mkdir public\sounds -Force
mkdir data -Force
```

The proper project structure must look like this:
```text
restaurant-table-kiosk-system-main/
│
├── public/
│   ├── admin.html
│   ├── kiosk.html
│   ├── login.html
│   ├── reset-password.html
│   ├── img/
│   ├── videos/
│   └── sounds/
│
├── data/
│   └── kiosk.db (created automatically on first run)
│
├── server.js
├── package.json
└── .env
```


## 4. Install Dependencies
The package.json supplied may not include all required modules. To avoid Cannot find module errors, install the complete dependency set with a single command:
```powershell
npm install express socket.io multer uuid sql.js bcrypt express-rate-limit nodemailer express-session axios iyzipay stripe dotenv cors qrcode jspdf html2canvas
```
## 6.Check if a .env file already exists (it usually does). If not, create one:
Create a new configuration file:
```powershell
New-Item .env
```

Open the `.env` file and insert the following environment variables:
```env
PORT=3000
PAYMENT_PROVIDER=simulation

SMTP_HOST=://gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_application_password
SMTP_SECURE=false
```

## 7. Restore Existing Data (Optional)
If migrating from an existing setup or deployment:
* Copy your existing database file `kiosk.db` directly into the `data\` folder.
* Copy your media assets into their respective folders:
  - `public\img\`
  - `public\videos\`
  - `public\sounds\`

> ⚠️ **Important:** The SQLite database stores relative file paths only. All product images, loops, and notification sounds must exist physically inside the targeted folders inside `public\` to prevent layout breakage.

## 8. Start Application
```powershell
node server.js
```

Upon successful connection, the local terminal output will show:
```text
Chef İstanbul — Ready!
http://localhost:3000
```

🌐 **Access Pages locally via:**
* **Admin Panel:** `http://localhost:3000/admin`
* **Login Gateway:** `http://localhost:3000/login`
* **Kiosk Example (Table 1):** `http://localhost:3000/kiosk/table-1`  
  *(Note: The table slug identifier changes automatically depending on the specific tables created inside the Admin Panel.)*

---

## 🔐 Default Admin Account
The system automatically creates a default administrator account on the first installation run. Please change the password after the first login.

| Username | Password |
| :--- | :--- |
| **admin** | **admin123** |

---

## 🛠️ Technologies

### Backend
* Node.js
* Express.js
* Socket.io
* SQLite (`sql.js`)
* bcrypt
* multer

### Frontend
* HTML5
* CSS3
* JavaScript ES6+

---

## 🌐 LAN Usage
The application operates autonomously without external internet dependencies. Ensure all physical terminal hardware endpoints connect to the exact same Wi-Fi access point or local subnet.

* **Example Host Server IP:** `192.168.1.100`
* **Customer Kiosk URL:** `http://192.168.1`
* **Staff Admin URL:** `http://192.168.1`

---

## 💳 Payment Systems
Switch payment gateways smoothly through the `PAYMENT_PROVIDER` identifier inside your `.env` configuration file. 

Available modules:
* `simulation` (Local sandbox development mode)
* `stripe`
* `iyzico`
* `paytr`

---

## 🧩 Development Notes

During development, some dependency and environment-related issues may occur depending on the Windows configuration.

### Node.js and npm Issues
If package installation fails, remove existing dependencies and reinstall using PowerShell:
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

### Missing Packages
If a required package is missing, install dependencies again:
```powershell
npm install
```

Main dependencies used in this project: `express`, `socket.io`, `sql.js`, `express-session`, `bcrypt`, `multer`, `dotenv`, `cors`, `qrcode`, `nodemailer`, `jspdf`, `html2canvas`.

### Windows Environment
The project was developed and tested on Windows environments using Node.js. 

Ensure:
* Node.js v18+ is installed.
* `npm` is available and mapped in your PowerShell environment variables.
* The application is executed directly from the project root directory.

---

## 📋 Troubleshooting

#### ❗ Missing `node_modules`
**Solution:** A fresh dependencies installation request is required. Run:
```powershell
npm install
```

#### ❗ `ERR_CONNECTION_REFUSED`
**Solution:** The core local backend node process isn't running. Start the application engine inside the proper root directory via:
```powershell
npm start
```

#### ❗ Images / Asset Files Not Showing
**Solution:** Verify the actual image assets are inside `public\img\` and check whether the database file paths perfectly match the physical filenames on disk (pay close attention to case sensitivity and standard naming rules).

#### ❗ 404 Route Errors
**Solution:** Make sure your static assets are grouped inside the public space. Double-check that these entry files exist:
* `public\admin.html`
* `public\kiosk.html`
* `public\login.html`

---

## ⚡ Quick Start Summary (PowerShell)
```powershell
mkdir public -Force
mkdir public\img -Force
mkdir public\videos -Force
mkdir public\sounds -Force
mkdir data -Force

Move-Item admin.html,kiosk.html,login.html,reset-password.html public

npm install
npm start
```

---

## 📄 License
This project is open-source software licensed under the **MIT License**.

## 👨‍💻 Developer
Developed by **Parwiz Abdulhameed**
