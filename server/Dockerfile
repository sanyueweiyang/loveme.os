# Use Node.js LTS (Alpine) for a small and secure base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install all dependencies (including devDependencies for build tools)
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the TypeScript code and generate Prisma Client
# This runs: tsc && prisma generate
RUN npm run build

# Expose the application port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
