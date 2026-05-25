import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './user.entity';
import { Role, type CreateUserDto, type UpdateUserDto } from '@terra-os/types';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private repo: Repository<UserEntity>,
  ) {}

  async findAll(): Promise<UserEntity[]> {
    const users = await this.repo.find();
    return users.map((user) => this.sanitize(user));
  }

  async findById(id: string): Promise<UserEntity | null> {
    const user = await this.repo.findOneBy({ id });
    return this.sanitize(user);
  }

  async findByEmail(email: string, includePassword = false): Promise<UserEntity | null> {
    if (includePassword) {
      return this.repo
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.email = :email', { email })
        .getOne();
    }
    const user = await this.repo.findOneBy({ email });
    return this.sanitize(user);
  }

  countAdmins(): Promise<number> {
    return this.repo.countBy({ role: Role.ADMIN });
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const existing = await this.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.repo.create({ ...dto, passwordHash });
    return this.sanitize(await this.repo.save(user));
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    Object.assign(user, dto);
    return this.sanitize(await this.repo.save(user));
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    await this.repo.remove(user);
  }

  private sanitize<T extends UserEntity | null>(user: T): T {
    if (user) {
      delete (user as Partial<UserEntity>).passwordHash;
    }
    return user;
  }
}
