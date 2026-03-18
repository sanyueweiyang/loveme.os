FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
# 注意：如果 Dockerfile 在 server 文件夹内，路径就要写成 ./package*.json
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "start"]