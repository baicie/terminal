import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
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
})
export class AppModule {}
