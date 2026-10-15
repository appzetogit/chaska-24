# Local development image. The compose setup bind-mounts the source over
# this, so edits reload through Vite's dev server without a rebuild.
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
