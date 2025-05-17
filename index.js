const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;

// Store for waiting users
const waitingUsers = {
  global: [],
};

// Store for active rooms
const activeRooms = new Map();

// Helper function to find a match for a user
function findMatch(userId, country) {
  // Initialize country-specific waiting room if it doesn't exist
  if (!waitingUsers[country]) {
    waitingUsers[country] = [];
  }

  // First try to match with someone from the same country
  if (waitingUsers[country].length > 0) {
    const matchedUser = waitingUsers[country].shift();
    return matchedUser;
  }

  // If no match in the same country, try the global pool
  if (waitingUsers.global.length > 0) {
    const matchedUser = waitingUsers.global.shift();
    return matchedUser;
  }

  // No match found
  return null;
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join waiting room
  socket.on("join_waiting_room", ({ userId, country = "global" }) => {
    console.log(`User ${userId} (${socket.id}) joined waiting room for ${country}`);

    // Try to find a match
    const match = findMatch(userId, country);

    if (match) {
      // Create a new room for the matched users
      const roomId = `room_${Math.random().toString(36).substr(2, 9)}`;

      // Add both users to the room
      socket.join(roomId);
      io.sockets.sockets.get(match.socketId)?.join(roomId);

      // Store room information
      activeRooms.set(roomId, {
        users: [
          { userId, socketId: socket.id },
          { userId: match.userId, socketId: match.socketId },
        ],
        createdAt: Date.now(),
      });

      // Notify both users about the match
      io.to(match.socketId).emit("matched", {
        roomId,
        peerId: socket.id,
      });

      socket.emit("matched", {
        roomId,
        peerId: match.socketId,
      });

      console.log(`Matched users in room ${roomId}: ${userId} and ${match.userId}`);
    } else {
      // Add user to waiting room
      const waitingUser = {
        userId,
        socketId: socket.id,
        country,
        joinedAt: Date.now(),
      };

      // Add to country-specific room and global room for better matching chances
      if (country !== "global") {
        if (!waitingUsers[country]) {
          waitingUsers[country] = [];
        }
        waitingUsers[country].push(waitingUser);
      }
      waitingUsers.global.push(waitingUser);

      console.log(`User ${userId} added to waiting room for ${country}`);
    }
  });

  socket.on("offer", ({ roomId, offer, peerId }) => {
    console.log(`Received offer in room ${roomId}`);
    io.to(peerId).emit("offer", {
      offer,
      sender: socket.id,
    });
  });

  socket.on("answer", ({ roomId, answer, peerId }) => {
    console.log(`Received answer in room ${roomId}`);
    io.to(peerId).emit("answer", {
      answer,
      sender: socket.id,
    });
  });

  socket.on("ice-candidate", ({ roomId, candidate, peerId }) => {
    io.to(peerId).emit("ice-candidate", {
      candidate,
      sender: socket.id,
    });
  });

  // Handle chat messages
  socket.on("chat_message", ({ roomId, message, peerId }) => {
    socket.to(roomId).emit("chat_message", {
      message,
      sender: socket.id,
    });
  });

  // Handle leaving a room
  socket.on("leave_room", ({ roomId }) => {
    if (roomId && activeRooms.has(roomId)) {
      const room = activeRooms.get(roomId);

      // Notify the other user in the room
      room.users.forEach((user) => {
        if (user.socketId !== socket.id) {
          io.to(user.socketId).emit("peer_disconnected");
        }
      });

      // Remove the room if both users have left
      socket.leave(roomId);
      const remainingUsers = io.sockets.adapter.rooms.get(roomId);
      if (!remainingUsers || remainingUsers.size === 0) {
        activeRooms.delete(roomId);
        console.log(`Room ${roomId} deleted`);
      }
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Remove user from waiting rooms
    Object.keys(waitingUsers).forEach((country) => {
      waitingUsers[country] = waitingUsers[country].filter((user) => user.socketId !== socket.id);
    });

    // Notify peers in active rooms
    activeRooms.forEach((room, roomId) => {
      const userInRoom = room.users.find((user) => user.socketId === socket.id);

      if (userInRoom) {
        // Notify the other user
        room.users.forEach((user) => {
          if (user.socketId !== socket.id) {
            io.to(user.socketId).emit("peer_disconnected");
          }
        });

        // Check if room is empty
        const remainingUsers = io.sockets.adapter.rooms.get(roomId);
        if (!remainingUsers || remainingUsers.size === 0) {
          activeRooms.delete(roomId);
          console.log(`Room ${roomId} deleted after disconnect`);
        }
      }
    });
  });
});

// Clean up stale waiting users periodically
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes

  Object.keys(waitingUsers).forEach((country) => {
    waitingUsers[country] = waitingUsers[country].filter((user) => {
      const isStale = now - user.joinedAt > timeout;
      if (isStale) {
        console.log(`Removing stale user ${user.userId} from ${country} waiting room`);
      }
      return !isStale;
    });
  });
}, 60 * 1000); // Run every minute

app.get("/", (req, res) => {
  res.send("Random Video Chat Signaling Server");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Signaling server is running on port ${PORT}`);
});