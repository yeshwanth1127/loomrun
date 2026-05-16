from prisma import Prisma

from loomrun_api.config import settings

prisma = Prisma(datasource={'url': settings.database_url})
