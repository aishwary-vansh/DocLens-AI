// src/gateway/gateway.module.ts
import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [EventsGateway],
  exports:   [EventsGateway],
})
export class GatewayModule {}
