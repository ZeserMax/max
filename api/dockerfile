FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 只安装生产依赖（如需开发依赖可去掉 --only=production）
COPY package.json .
RUN npm install --only=production

# 复制其余源码
COPY . .

# 暴露 server.js 中使用的端口（默认 8080）
EXPOSE 8080

# 启动命令
CMD ["npm", "start"]
