FROM apify/actor-node:22

COPY package*.json ./
RUN npm --quiet set progress=false && npm install --no-optional

COPY . ./
RUN npm run build && npm prune --omit=dev

CMD ["node", "dist/main.js"]
