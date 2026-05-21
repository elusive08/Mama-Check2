import jwt from "jsonwebtoken";
import User from "../models/User.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new Error("No authorization token provided");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({
      _id: decoded.userId,
      "optOut.isOptedOut": false,
    });

    if (!user) {
      throw new Error("User not found or has opted out");
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error("Authentication error:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(401).json({ error: "Please authenticate" });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }
    next();
  };
};

const requireCHEW = requireRole("chew", "supervisor", "admin");
const requireSupervisor = requireRole("supervisor", "admin");

export { authMiddleware, requireRole, requireCHEW, requireSupervisor };
