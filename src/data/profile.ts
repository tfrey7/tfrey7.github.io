export type Role = {
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  bullets: string[];
};

export type Project = {
  name: string;
  blurb: string;
  tags: string[];
  repoUrl?: string;
  liveUrl?: string;
};

export type SkillGroup = {
  label: string;
  items: string[];
};

export type Education = {
  school: string;
  degree: string;
  location: string;
};

export type Contact = {
  name: string;
  location: string;
  email: string;
  phone?: string;
  github: string;
  resumeUrl?: string;
};

export const contact: Contact = {
  name: 'Timothy J. Frey',
  location: 'New York, NY',
  email: 'me@tfrey7.com',
  github: 'https://github.com/tfrey7',
  // resumeUrl: '/personal-profile/resume.pdf',   // TODO: drop into public/resume.pdf to enable
};

export const experience: Role[] = [
  {
    company: 'Otti, Inc.',
    title: 'Founding Engineer',
    location: 'New York, NY',
    start: 'Jan 2024',
    end: 'Apr 2025',
    bullets: [
      'Architected and built a full-stack Next.js / Fastify monolith on PostgreSQL from scratch.',
      'Designed CI/CD pipelines and core development workflows to establish the engineering foundation.',
      'Integrated the OpenAI API to automate intelligent content summaries within the core product.',
      'Helped scale the company from inception to three-year enterprise contracts within the first year.',
      'Implemented fine-grained, object-based permissions across the platform with OsoCloud.',
    ],
  },
  {
    company: 'Greenhouse Software',
    title: 'Staff Software Engineer',
    location: 'New York, NY',
    start: 'Oct 2013',
    end: 'Dec 2023',
    bullets: [
      'Helped grow the engineering team from 3 to 100+ — mentored junior engineers, ran hundreds of technical interviews, shaped culture.',
      'Owned and resolved high-complexity, stalled initiatives to unblock the development pipeline.',
      'Built automated data-recovery tooling for PostgreSQL and S3, reducing manual support overhead.',
      'Revamped downtime alerting to optimize reliability and incident-response workflows.',
    ],
  },
  {
    company: 'The New York Times',
    title: 'Senior Developer — Ecommerce Platform',
    location: 'New York, NY',
    start: 'Mar 2013',
    end: 'Oct 2013',
    bullets: [],
  },
  {
    company: 'Thomson Reuters',
    title: 'Senior Technologist (Eikon)',
    location: 'New York, NY',
    start: 'Jun 2010',
    end: 'Mar 2013',
    bullets: [],
  },
];

export const skills: SkillGroup[] = [
  { label: 'Languages', items: ['Ruby', 'JavaScript', 'TypeScript', 'Java', 'SQL'] },
  { label: 'Frameworks & Libraries', items: ['Ruby on Rails', 'Next.js', 'Fastify', 'MikroORM', 'Zod'] },
  { label: 'Cloud & Databases', items: ['AWS', 'PostgreSQL'] },
  { label: 'Observability & Analytics', items: ['Datadog', 'PostHog'] },
  { label: 'AI & Developer Tools', items: ['OpenAI API', 'Claude Code', 'GitHub Copilot', 'Graphite'] },
];

export const education: Education = {
  school: 'Stony Brook University',
  degree: 'B.S. in Computer Science',
  location: 'Stony Brook, NY',
};

export const projects: Project[] = [
  // TODO: featured projects — add entries as you choose what to highlight.
  // Shape: { name, blurb, tags: ['TypeScript', ...], repoUrl?, liveUrl? }
];
