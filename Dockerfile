# Use a slim version of Node.js
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Expose the port (Fly.io uses PORT env var, but we'll default to 3000)
EXPOSE 3000

# Start the application
CMD [ "npm", "start" ]
