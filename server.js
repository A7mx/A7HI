const express = require('express');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const dotenv = require('dotenv');
const session = require('express-session');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname)));
app.use(express.urlencoded({ extended: true })); // Parse form data
app.use(
  session({
    secret: 'your-secret-key', // Replace with a secure secret
    resave: false,
    saveUninitialized: true,
  })
);

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const  COADMIN_ROLE_ID = process.env.COADMIN_ROLE_ID
const DATABASE_CHANNEL_ID = process.env.DATABASE_CHANNEL_ID;

// Hardcoded credentials (replace with a database in production)
const VALID_CREDENTIALS = {
  username: 'admin',
  password: 'password123', // Replace with a hashed password in production
};

// In-memory database (for simplicity)
const adminTimingData = {};
const adminMessageIds = {}; // To track individual messages for each user

// Discord Bot
const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

bot.on('ready', async () => {
  console.log(`Bot logged in as ${bot.user.tag}`);

  // Fetch existing messages from the database channel
  const databaseChannel = await bot.channels.fetch(DATABASE_CHANNEL_ID);
  if (!databaseChannel) return console.error('Database channel not found.');

  try {
    // Fetch all messages (up to 100 at a time)
    let messages = await databaseChannel.messages.fetch({ limit: 100 });
    while (messages.size > 0) {
      messages.forEach((message) => {
        const content = message.content.split('\n');

        // Try to extract User ID, Total Time, and Name using regex
        const userIdMatch = content[0]?.match(/User ID:\s+(\d+)/);
        const totalTimeMatch = content[1]?.match(/Total Time:\s+(\d+h\s+\d+m)/);
        const nameMatch = content[2]?.match(/Name:\s+(.+)/);

        if (userIdMatch && totalTimeMatch && nameMatch) {
          const userId = userIdMatch[1];
          const totalTime = parseTime(totalTimeMatch[1]);
          const name = nameMatch[1].trim();

          adminTimingData[userId] = { totalTime, sessions: [], name };
          adminMessageIds[userId] = message.id; // Store the message ID for updates
        }
      });

      // Fetch older messages if available
      const lastMessageId = messages.last().id;
      messages = await databaseChannel.messages.fetch({ limit: 100, before: lastMessageId });
    }

    console.log(`Loaded data for ${Object.keys(adminTimingData).length} users.`);
  } catch (error) {
    console.error('Error fetching messages from database channel:', error);
  }
});

bot.on('voiceStateUpdate', async (oldState, newState) => {
  const member = oldState.member || newState.member;

  // Check if the user has the admin role
  if (!member.roles.cache.has(ADMIN_ROLE_ID)) return;
  if (!member.roles.cache.has(COADMIN_ROLE_ID)) return;

  const adminId = member.id;
  const now = Date.now();

  if (newState.channel && !oldState.channel) {
    // Admin joined a voice channel
    adminTimingData[adminId] = adminTimingData[adminId] || { sessions: [] };
    adminTimingData[adminId].joinTime = now;
  } else if (!newState.channel && oldState.channel) {
    // Admin left a voice channel
    const joinTime = adminTimingData[adminId]?.joinTime;
    if (joinTime) {
      const timeSpent = now - joinTime;
      adminTimingData[adminId].totalTime = (adminTimingData[adminId].totalTime || 0) + timeSpent;
      adminTimingData[adminId].sessions.push({ timestamp: now, timeSpent });
      delete adminTimingData[adminId].joinTime;

      // Update the database channel message
      const databaseChannel = await bot.channels.fetch(DATABASE_CHANNEL_ID);
      if (!databaseChannel) return console.error('Database channel not found.');

      const user = await bot.users.fetch(adminId);
      const member = await bot.guilds.cache.first().members.fetch(adminId).catch(() => null);
      const nickname = member?.nickname || user.username;

      // Ensure the name is properly stored
      adminTimingData[adminId].name = nickname;

      const messageContent = `
        User ID: ${adminId}
        Total Time: ${formatTime(adminTimingData[adminId].totalTime)}
        Name: ${nickname}
      `;

      if (adminMessageIds[adminId]) {
        // Edit the existing message
        const message = await databaseChannel.messages.fetch(adminMessageIds[adminId]);
        message.edit(messageContent);
      } else {
        // Create a new message and pin it
        const sentMessage = await databaseChannel.send(messageContent);
        adminMessageIds[adminId] = sentMessage.id;
        sentMessage.pin(); // Pin the message for easy access
      }
    }
  }
});


// Start the bot
bot.login(BOT_TOKEN);

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.isLoggedIn) {
    return next(); // User is authenticated, proceed to the next middleware/route
  }
  res.redirect('/login'); // Redirect to login page if not authenticated
}

// Serve the Login Page
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          background-color: #f8f9fa;
          height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .login-container {
          width: 100%;
          max-width: 400px;
          padding: 20px;
          background-color: #fff;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
        }
        .error {
          color: red;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h2 class="text-center mb-4">Login</h2>
        <form method="POST" action="/login" class="needs-validation" novalidate>
          <div class="mb-3">
            <label for="username" class="form-label">Username</label>
            <input type="text" class="form-control" id="username" name="username" required>
          </div>
          <div class="mb-3">
            <label for="password" class="form-label">Password</label>
            <input type="password" class="form-control" id="password" name="password" required>
          </div>
          <button type="submit" class="btn btn-primary w-100">Login</button>
        </form>
        ${req.query.error ? '<p class="error mt-3">Invalid credentials. Please try again.</p>' : ''}
      </div>
    </body>
    </html>
  `);
});

// Handle Login POST Request
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Check credentials
  if (username === VALID_CREDENTIALS.username && password === VALID_CREDENTIALS.password) {
    req.session.isLoggedIn = true; // Mark user as logged in
    return res.redirect('/'); // Redirect to dashboard
  }

  // Invalid credentials, redirect back to login with an error message
  res.redirect('/login?error=true');
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/login'); // Redirect to login page after logout
  });
});

// Serve the Dashboard (Protected Route)
app.get('/', isAuthenticated, async (req, res) => {
  const admins = Object.keys(adminTimingData).map(async (adminId) => {
    const { totalTime, sessions } = adminTimingData[adminId];

    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0); // Midnight of the current day
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000; // 7 days ago
    const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000; // 30 days ago

    const todayTime = sessions
      .filter((session) => session.timestamp >= todayStart)
      .reduce((sum, session) => sum + session.timeSpent, 0);

    const weeklyTime = sessions
      .filter((session) => session.timestamp >= oneWeekAgo)
      .reduce((sum, session) => sum + session.timeSpent, 0);

    const monthlyTime = sessions
      .filter((session) => session.timestamp >= oneMonthAgo)
      .reduce((sum, session) => sum + session.timeSpent, 0);

    const user = await bot.users.fetch(adminId).catch(() => null);
    const member = await bot.guilds.cache.first().members.fetch(adminId).catch(() => null);
    const nickname = member?.nickname || user?.username || 'Unknown';
    const avatar = user?.displayAvatarURL() || 'https://via.placeholder.com/50';

    return {
      adminId,
      name: nickname,
      avatar,
      totalTime: formatTime(totalTime),
      todayTime: formatTime(todayTime),
      weeklyTime: formatTime(weeklyTime),
      monthlyTime: formatTime(monthlyTime),
    };
  });

  const resolvedAdmins = await Promise.all(admins);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css">
      <style>
        body {
          background-color: #f8f9fa;
        }
        .dashboard-container {
          padding: 20px;
        }
        .search-bar {
          margin-bottom: 20px;
        }
        img.avatar {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          cursor: pointer;
        }
        .modal {
          display: none;
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background-color: #fff;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
          z-index: 1000;
          width: 400px;
        }
        .overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          z-index: 999;
        }
      </style>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
        <div class="container-fluid">
          <a class="navbar-brand" href="#">Admin Dashboard</a>
          <div class="d-flex">
            <a href="/logout" class="btn btn-outline-light">Logout</a>
          </div>
        </div>
      </nav>
      <div class="container dashboard-container">
        <div class="search-bar">
          <input type="text" id="searchInput" class="form-control" placeholder="Search by name">
        </div>
        <table class="table table-striped">
          <thead>
            <tr>
              <th>Avatar</th>
              <th>Name</th>
              <th>Today</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="adminTableBody">
            ${resolvedAdmins
              .map(
                (admin) => `
                  <tr>
                    <td><img src="${admin.avatar}" alt="${admin.name}'s Avatar" class="avatar" onclick="showDetails('${admin.adminId}')"></td>
                    <td>${admin.name}</td>
                    <td>${admin.todayTime}</td>
                    <td>
                      <button class="btn btn-sm btn-primary" onclick="showToday('${admin.adminId}')">Today</button>
                      <button class="btn btn-sm btn-secondary" onclick="openCalendar('${admin.adminId}', 'weekly')">Weekly</button>
                      <button class="btn btn-sm btn-success" onclick="openCalendar('${admin.adminId}', 'monthly')">Monthly</button>
                      <button class="btn btn-sm btn-info" onclick="showAllTime('${admin.adminId}')">All-Time</button>
                    </td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Modal for User Details -->
      <div class="overlay" id="overlay"></div>
      <div class="modal" id="modal">
        <h2>User Details</h2>
        <p id="modalContent"></p>
        <button class="btn btn-primary" onclick="closeModal()">Close</button>
      </div>

      <!-- Calendar Modal -->
      <div class="overlay" id="calendarOverlay"></div>
      <div class="modal" id="calendarModal">
        <h2>Select Date Range</h2>
        <input type="text" id="calendar" placeholder="Select Date Range">
        <button class="btn btn-primary mt-3" onclick="getSelectedTime()">Submit</button>
        <button class="btn btn-secondary mt-3" onclick="closeCalendar()">Cancel</button>
      </div>

      <!-- Flatpickr JS -->
      <script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
      <script>
        let selectedAdmin = null;
        let selectedPeriod = null;

        function showDetails(adminId) {
          selectedAdmin = ${JSON.stringify(resolvedAdmins)}.find(a => a.adminId === adminId);
          const modalContent = document.getElementById('modalContent');
          modalContent.innerHTML = \`
            <strong>Name:</strong> \${selectedAdmin.name}<br>
            <strong>Total Time:</strong> \${selectedAdmin.totalTime}<br>
            <button class="btn btn-sm btn-warning mt-3" onclick="showUserId()">Show User ID</button>
            <p id="userIdDisplay" style="display: none;"><strong>User ID:</strong> \${selectedAdmin.adminId}</p>
          \`;

          const overlay = document.getElementById('overlay');
          const modal = document.getElementById('modal');
          overlay.style.display = 'block';
          modal.style.display = 'block';
        }

        function closeModal() {
          const overlay = document.getElementById('overlay');
          const modal = document.getElementById('modal');
          overlay.style.display = 'none';
          modal.style.display = 'none';
        }

        function showUserId() {
          const userIdDisplay = document.getElementById('userIdDisplay');
          userIdDisplay.style.display = 'block';
        }

        function showToday(adminId) {
          const admin = ${JSON.stringify(resolvedAdmins)}.find(a => a.adminId === adminId);
          alert(\`Today's Time: \${admin.todayTime}\`);
        }

        function showAllTime(adminId) {
          const admin = ${JSON.stringify(resolvedAdmins)}.find(a => a.adminId === adminId);
          alert(\`All-Time: \${admin.totalTime}\`);
        }

        function openCalendar(adminId, period) {
          selectedAdmin = ${JSON.stringify(resolvedAdmins)}.find(a => a.adminId === adminId);
          selectedPeriod = period;

          const calendarOverlay = document.getElementById('calendarOverlay');
          const calendarModal = document.getElementById('calendarModal');
          calendarOverlay.style.display = 'block';
          calendarModal.style.display = 'block';

          flatpickr("#calendar", {
            mode: "range",
            dateFormat: "Y-m-d",
          });
        }

        function closeCalendar() {
          const calendarOverlay = document.getElementById('calendarOverlay');
          const calendarModal = document.getElementById('calendarModal');
          calendarOverlay.style.display = 'none';
          calendarModal.style.display = 'none';
        }

        function getSelectedTime() {
          const calendarInput = document.getElementById('calendar').value;
          const dates = calendarInput.split(' to ');

          if (dates.length !== 2) {
            alert('Please select a valid date range.');
            return;
          }

          const startDate = new Date(dates[0]).getTime();
          const endDate = new Date(dates[1]).getTime();

          const sessions = selectedAdmin.sessions.filter(session => session.timestamp >= startDate && session.timestamp <= endDate);
          const totalTime = sessions.reduce((sum, session) => sum + session.timeSpent, 0);

          alert(\`Total Time for \${selectedPeriod}: \${formatMilliseconds(totalTime)}\`);

          closeCalendar();
        }

        function formatMilliseconds(milliseconds) {
          const seconds = Math.floor(milliseconds / 1000);
          const minutes = Math.floor(seconds / 60);
          const hours = Math.floor(minutes / 60);
          return \`\${hours}h \${minutes % 60}m\`;
        }
      </script>
    </body>
    </html>
  `);
});

// Helper function to format time
function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// Helper function to parse time strings like "1h 30m" into milliseconds
function parseTime(timeString) {
  const match = timeString.match(/(\d+)h\s+(\d+)m/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return (hours * 60 * 60 + minutes * 60) * 1000;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
