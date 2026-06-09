import swaggerJSDoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Mama-Check API",
      version: "1.0.0",
      description:
        "API documentation for Mama-Check - Maternal and Child Health Monitoring System",
    },
    tags: [
      {
        name: "Auth",
        description: "Authentication and user management",
      },
      {
        name: "Pregnancies",
        description: "Pregnancy monitoring and management",
      },
      {
        name: "Dashboard",
        description: "User dashboard and statistics",
      },
      {
        name: "CHEW",
        description: "Community Health Extension Worker operations",
      },
      {
        name: "Webhook",
        description: "External service webhooks",
      },
      {
        name: "Health",
        description: "System health and status",
      },
    ],
    servers: [
      { url: "http://localhost:3000", description: "Local Development" },
      { url: "https://api.mamacheck.health", description: "Production" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token in the format: Bearer <token>",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            message: {
              type: "string",
              example: "Error message",
            },
            error: {
              type: "object",
            },
          },
        },
        User: {
          type: "object",
          properties: {
            id: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            email: {
              type: "string",
              format: "email",
            },
            role: {
              type: "string",
              enum: ["patient", "chew", "supervisor", "admin"],
            },
            firstName: {
              type: "string",
            },
            lastName: {
              type: "string",
            },
          },
        },
        Pregnancy: {
          type: "object",
          properties: {
            id: {
              type: "string",
            },
            userId: {
              type: "string",
            },
            gestationalAge: {
              type: "number",
              description: "Weeks of pregnancy",
            },
            estimatedDeliveryDate: {
              type: "string",
              format: "date",
            },
            riskLevel: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            lastVisitDate: {
              type: "string",
              format: "date-time",
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    "./src/routes/auth.js",
    "./src/routes/pregnancies.js",
    "./src/routes/dashboard.js",
    "./src/routes/chew.js",
    "./src/routes/webhook.js",
    "./src/app.js",
  ],
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;
