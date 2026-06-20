import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds robots.isSimulated (boolean, default false). Portable across the
 * sqlite (onboard/dev) and postgres (prod) drivers via TableColumn.
 */
export class AddIsSimulatedToRobot1717200000000 implements MigrationInterface {
  name = 'AddIsSimulatedToRobot1717200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('robots');
    if (table && !table.findColumnByName('isSimulated')) {
      await queryRunner.addColumn(
        'robots',
        new TableColumn({
          name: 'isSimulated',
          type: 'boolean',
          isNullable: false,
          default: false,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('robots');
    if (table && table.findColumnByName('isSimulated')) {
      await queryRunner.dropColumn('robots', 'isSimulated');
    }
  }
}
