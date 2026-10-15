# Local development image. Builds in ~minutes; the compose setup bind-mounts
# the source over this so edits reload without a rebuild, same way `npm run
# dev` behaves on a host machine.
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000 5001

CMD ["npm", "run", "dev"]
