/**
 * Catalog of agent skills from skills.yaml (git-based skills).
 */
import { CONFIG_FILES } from '../config/config';
import { loadYamlFile } from './loadYaml';
import { SkillsFileSchema, type SkillEntry } from './schemas';

export class SkillStore {
  private readonly skills: SkillEntry[];

  constructor(skills: SkillEntry[]) {
    this.skills = skills;
  }

  /** Loads and validates skills.yaml. Throws on any error. */
  static load(): SkillStore {
    return new SkillStore(loadYamlFile(CONFIG_FILES.skills, SkillsFileSchema).skills);
  }

  list(): SkillEntry[] {
    return this.skills;
  }

  get(name: string): SkillEntry | undefined {
    return this.skills.find(skill => skill.name === name);
  }
}
