FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY agent.mjs server.mjs coding.mjs code-model.mjs projects.mjs CLINE-LICENSE ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
