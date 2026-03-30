# WPSender

Servicio NestJS que envia reportes semanales de horas trabajadas por WhatsApp usando Twilio. Consulta registros de acceso desde SQL Server y notifica a empleados UOCRA con sus marcas de entrada/salida de los ultimos 7 dias.

## Funcionalidades

- Reporte semanal automatico (lunes 9:00 AM Argentina)
- Soporte para jornada corrida y jornada partida
- Filtrado de marcas duplicadas dentro de 5 minutos
- Envio masivo o individual por DNI

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/twilio/send-to-all` | Envia reporte a todos los empleados activos |
| POST | `/twilio/send-to-target` | Envia reporte a un empleado (`{ "dni": "12345678" }`) |

## Variables de entorno

```env
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
TWILIO_HOUR_TEMPLATE_ID=

# SQL Server
SQLSERVER_USER=
SQLSERVER_PASSWORD=
SQLSERVER_SERVER=
SQLSERVER_PORT=
SQLSERVER_DATABASE=
SQLSERVER_ENCRYPT=
SQLSERVER_TRUST_CERT=
```

## Setup

```bash
npm install
cp .env.example .env  # completar variables
npm run start:dev
```
