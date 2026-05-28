FROM python:3.12-slim

WORKDIR /app

COPY server.py .
COPY index.html .
COPY styles.css .
COPY calculator.js .
COPY fetcher.js .

EXPOSE 8080

CMD ["python", "server.py"]
