FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Expose the default Vite port
EXPOSE 5173

# Start the development server and bind to all interfaces
CMD ["npm", "run", "dev", "--", "--host"]

