const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors());

// Create Socket.io server with CORS configuration
const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your frontend URL
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// Variables to track users and rooms
let waitingUser = null; // waiting user
const rooms = {}; // roomId -> [socketId, socketId]
const pairMap = new Map();

// Serve a simple status page
app.get("/", (req, res) => {
  res.send("Video Chat Server is running");
});

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.emit("waiting", "Looking for a partner...");

  if (waitingUser === null) {
    waitingUser = socket;
  } else if (waitingUser.id !== socket.id) {
    const partner = waitingUser;
    waitingUser = null;

    // Room yaratish
    const roomId = `${socket.id}#${partner.id}`;
    rooms[roomId] = [socket.id, partner.id];
    pairMap.set(socket.id, partner.id);
    pairMap.set(partner.id, socket.id);

    socket.join(roomId);
    partner.join(roomId);

    io.to(roomId).emit("room-joined", roomId);
  }

  // Signal qabul qilish
  socket.on("signal", ({ signalData }) => {
    const partnerId = pairMap.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("signal", {
        from: socket.id,
        signalData,
      });
    }
  });

  // Handle chat messages
  socket.on("chat-message", (data) => {
    // data: { roomId, message }
    io.to(data.roomId).emit("chat-message", {
      from: socket.id,
      message: data.message,
    });
  });

  // Handle finding a new partner
  socket.on("find-partner", () => {
    // Remove from current room if any
    for (const roomId in rooms) {
      if (rooms[roomId].includes(socket.id)) {
        // Notify the other user
        socket.to(roomId).emit("user-disconnected");

        // Clean up the room
        delete rooms[roomId];

        // Leave the room
        socket.leave(roomId);
      }
    }

    // Add to waiting queue or match with waiting user
    if (waitingUser === null) {
      waitingUser = socket;
      socket.emit("waiting", "Looking for a partner...");
    } else if (waitingUser.id !== socket.id) {
      // Create a new room
      const roomId = `${socket.id}#${waitingUser.id}`;
      rooms[roomId] = [waitingUser.id, socket.id];

      // Add both users to the room
      waitingUser.join(roomId);
      socket.join(roomId);

      // Notify both users about the room
      io.to(roomId).emit("room-joined", roomId);

      // Reset waiting user
      waitingUser = null;
    }
  });

  // Handle leaving a room
  socket.on("leave-room", (roomId) => {
    if (rooms[roomId]) {
      // Notify the other user
      socket.to(roomId).emit("user-disconnected");

      // Clean up the room
      delete rooms[roomId];

      // Leave the room
      socket.leave(roomId);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const partnerId = pairMap.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("user-disconnected");
      pairMap.delete(partnerId);
      pairMap.delete(socket.id);
    }

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }

    for (const roomId in rooms) {
      if (rooms[roomId].includes(socket.id)) {
        delete rooms[roomId];
      }
    }
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
