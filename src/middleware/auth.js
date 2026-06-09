import jwt from "jsonwebtoken";
import User from "../models/User.js";
import redis from "../config/redis.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "Please authenticate" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check token revocation list
    const isRevoked = await redis.get(`revoked:${token}`);
    if (isRevoked) {
      return res.status(401).json({ error: "Token has been revoked" });
    }

    // FIXED: `"optOut.isOptedOut": false` won't match documents where
    // the field is absent (undefined). Use $ne: true instead — this matches
    // both false and missing/null, which is the correct semantic.
    const user = await User.findOne({
      _id: decoded.userId,
      "optOut.isOptedOut": { $ne: true },
    });

    if (!user) {
      return res.status(401).json({ error: "Please authenticate" });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    // Log only unexpected errors; JWT expiry / bad signature are normal
    if (!["JsonWebTokenError", "TokenExpiredError"].includes(error.name)) {
      console.error("Authentication error:", error.message);
    }
    return res.status(401).json({ error: "Please authenticate" });
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

const revokeToken = async (token) => {
  try {
    const decoded = jwt.decode(token);
    if (decoded?.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redis.setex(`revoked:${token}`, ttl, "1");
      }
    }
  } catch (error) {
    console.error("Error revoking token:", error);
  }
};

const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );
  const refreshToken = jwt.sign(
    { userId: user._id, type: "refresh" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );
  return { accessToken, refreshToken };
};

const refreshAccessToken = async (refreshToken) => {
  const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
  if (decoded.type !== "refresh") throw new Error("Invalid token type");
  const user = await User.findById(decoded.userId);
  if (!user) throw new Error("User not found");
  return generateTokens(user);
};

const requireCHEW = requireRole("chew", "supervisor", "admin");
const requireSupervisor = requireRole("supervisor", "admin");
const requireAdmin = requireRole("admin");

export {
  authMiddleware,
  revokeToken,
  generateTokens,
  refreshAccessToken,
  requireRole,
  requireCHEW,
  requireSupervisor,
  requireAdmin,
};
