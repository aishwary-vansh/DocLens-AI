// src/gateway/events.gateway.ts
// Socket.io gateway — broadcasts document status changes in real time.
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    credentials: true,
  },
  namespace: '/',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connected = 0;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    try {
      if (!token) throw new Error('Missing token');
      client.data.user = this.jwt.verify(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
    } catch {
      client.disconnect(true);
      return;
    }
    this.connected++;
    console.log(`[WS] Client connected: ${client.id} (total: ${this.connected})`);
  }

  handleDisconnect(client: Socket) {
    this.connected--;
    console.log(`[WS] Client disconnected: ${client.id} (total: ${this.connected})`);
  }

  // ── Subscribe client to a specific collection room ────────────
  @SubscribeMessage('join:collection')
  async handleJoinCollection(client: Socket, collectionId: string) {
    const allowed = await this.canAccessCollection(client, collectionId);
    if (!allowed) return;
    client.join(`collection:${collectionId}`);
    console.log(`[WS] ${client.id} joined collection:${collectionId}`);
  }

  @SubscribeMessage('leave:collection')
  handleLeaveCollection(client: Socket, collectionId: string) {
    client.leave(`collection:${collectionId}`);
  }

  // ── Emit helpers (called from DocumentsService) ───────────────
  emitDocumentUploaded(collectionId: string, doc: any) {
    this.server.to(`collection:${collectionId}`).emit('document:uploaded', doc);
  }

  emitStatusChanged(collectionId: string, doc: any) {
    this.server.to(`collection:${collectionId}`).emit('document:status', {
      id: doc.id,
      status: doc.status,
      updatedAt: doc.updatedAt,
      errorMessage: doc.errorMessage,
    });
  }

  emitDocumentDeleted(collectionId: string, id: string) {
    this.server.to(`collection:${collectionId}`).emit('document:deleted', { id });
  }

  private async canAccessCollection(client: Socket, collectionId: string): Promise<boolean> {
    const userId = client.data.user?.sub;
    if (!userId || !collectionId) return false;
    const collection = await this.prisma.collection.findFirst({
      where: {
        id: collectionId,
        workspace: { userId },
      },
      select: { id: true },
    });
    return Boolean(collection);
  }
}
