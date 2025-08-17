# Trending Finder

MVP backend para analizar tendencias en distintas plataformas sociales (Reddit, YouTube, Twitter/X) y recomendar a los creadores dónde conviene publicar su contenido.

## Características

- 🔍 Búsqueda de tendencias en múltiples plataformas
- 📊 Cálculo de momentum score (engagement/horas)
- 💾 Persistencia en Supabase (PostgreSQL)
- 🚀 API RESTful con Express.js
- 🧪 Tests unitarios completos
- 📝 Logging y manejo de errores
- 🔒 Rate limiting y validación

## Stack Tecnológico

- **Backend**: Node.js + Express.js
- **Base de datos**: Supabase (PostgreSQL)
- **ORM**: Drizzle ORM
- **Validación**: Zod
- **Logging**: Winston
- **Testing**: Jest
- **TypeScript**: Configuración estricta

## Instalación

1. Clonar el repositorio:
```bash
git clone <repository-url>
cd trending-finder
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
```bash
cp env.example .env
# Editar .env con tus credenciales
```

4. Configurar base de datos:
```bash
npm run db:generate
npm run db:migrate
```

5. Ejecutar en desarrollo:
```bash
npm run dev
```

## Variables de Entorno

- `DATABASE_URL`: URL de conexión a Supabase
- `REDDIT_CLIENT_ID`: Client ID de Reddit API
- `REDDIT_CLIENT_SECRET`: Client Secret de Reddit API
- `YOUTUBE_API_KEY`: API Key de YouTube Data API
- `TWITTER_BEARER_TOKEN`: Bearer Token de Twitter API v2
- `PORT`: Puerto del servidor (default: 3000)

## Uso de la API

### Endpoint Principal

```
GET /trends?q=keyword&platforms=reddit,youtube,x&timeframe=24h&lang=en&region=US
```

**Parámetros:**
- `q` (requerido): Keyword o tema a buscar
- `platforms`: Plataformas a consultar (reddit,youtube,x)
- `timeframe`: Ventana de tiempo (1h, 24h, 7d, 30d)
- `lang`: Idioma (en, es, fr, etc.)
- `region`: Región (US, ES, MX, etc.)

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "keyword": "AI + Coffee",
    "platforms": ["reddit", "youtube", "x"],
    "results": [
      {
        "id": "unique_id",
        "platform": "reddit",
        "author": "username",
        "content": "Post title or content",
        "metrics": {
          "upvotes": 150,
          "comments": 25
        },
        "link": "https://reddit.com/...",
        "createdAt": "2024-01-15T10:30:00Z",
        "momentumScore": 7.5
      }
    ]
  }
}
```

## Estructura del Proyecto

```
src/
├── controllers/     # Controladores de la API
├── services/        # Servicios para APIs externas
├── models/          # Modelos de datos
├── db/             # Configuración de base de datos
├── routes/          # Definición de rutas
├── middleware/      # Middlewares personalizados
├── utils/           # Utilidades y helpers
├── app.ts          # Configuración de Express
└── server.ts       # Punto de entrada
```

## Scripts Disponibles

- `npm run dev`: Ejecutar en modo desarrollo
- `npm run build`: Compilar TypeScript
- `npm start`: Ejecutar en producción
- `npm test`: Ejecutar tests
- `npm run test:watch`: Tests en modo watch
- `npm run lint`: Verificar código con ESLint
- `npm run lint:fix`: Corregir errores de ESLint
- `npm run format`: Formatear código con Prettier

## Desarrollo

### Agregar Nueva Plataforma

1. Crear nuevo servicio en `src/services/`
2. Implementar interfaz común
3. Agregar a la factory de servicios
4. Crear tests unitarios

### Ejemplo de Servicio

```typescript
export class TikTokService implements PlatformService {
  async searchTrends(keyword: string, options: SearchOptions): Promise<Post[]> {
    // Implementación específica de TikTok
  }
}
```

## Testing

```bash
# Ejecutar todos los tests
npm test

# Tests en modo watch
npm run test:watch

# Tests con coverage
npm test -- --coverage
```

## Deploy

### Render

1. Conectar repositorio a Render
2. Configurar variables de entorno
3. Deploy automático en push a main

### Fly.io

1. Instalar Fly CLI
2. Configurar `fly.toml`
3. Deploy con `fly deploy`

## Contribución

1. Fork del repositorio
2. Crear feature branch
3. Commit de cambios
4. Push al branch
5. Crear Pull Request

## Licencia

MIT
