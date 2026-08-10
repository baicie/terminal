import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuditModule } from './audit/audit.module'
import { AuthModule } from './auth/auth.module'
import { HealthModule } from './health/health.module'
import { InvitesModule } from './invites/invites.module'
import { MembersModule } from './members/members.module'
import { PrismaModule } from './prisma.module'
import { SharesModule } from './shares/shares.module'
import { SyncModule } from './sync/sync.module'
import { TeamsModule } from './teams/teams.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    AuthModule,
    TeamsModule,
    MembersModule,
    SharesModule,
    InvitesModule,
    AuditModule,
    SyncModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
