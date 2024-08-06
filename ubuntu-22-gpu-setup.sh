---
- name: Install and configure MAAS
  hosts: all
  become: yes
  vars:
    maas_version: "3.4"
    maas_dbuser: "maasuser"
    maas_dbpass: "maaspassword"
    maas_dbname: "maasdb"
    hostname: "localhost"
  tasks:
    - name: Update and upgrade apt packages
      apt:
        update_cache: yes
        upgrade: dist

    - name: Install Snapd
      apt:
        name: snapd
        state: present

    - name: Install MAAS from snap
      command: "snap install --channel={{ maas_version }} maas"

    - name: Add PostgreSQL APT repository
      apt_repository:
        repo: 'deb http://apt.postgresql.org/pub/repos/apt focal-pgdg main'
        state: present
        filename: 'pgdg'

    - name: Import PostgreSQL signing key
      apt_key:
        url: https://www.postgresql.org/media/keys/ACCC4CF8.asc
        state: present

    - name: Update apt cache after adding PostgreSQL repo
      apt:
        update_cache: yes

    - name: Install PostgreSQL 14
      apt:
        name: postgresql-14
        state: present

    - name: Create PostgreSQL user
      become_user: postgres
      command: "psql -c \"CREATE USER {{ maas_dbuser }} WITH ENCRYPTED PASSWORD '{{ maas_dbpass }}'\""

    - name: Create MAAS database
      become_user: postgres
      command: "createdb -O {{ maas_dbuser }} {{ maas_dbname }}"

    - name: Configure PostgreSQL to allow MAAS user access
      lineinfile:
        path: /etc/postgresql/14/main/pg_hba.conf
        line: "host    {{ maas_dbname }}    {{ maas_dbuser }}    0/0     md5"
        create: yes

    - name: Restart PostgreSQL
      service:
        name: postgresql
        state: restarted

    - name: Initialize MAAS
      command: "maas init region+rack --database-uri \"postgres://{{ maas_dbuser }}:{{ maas_dbpass }}@{{ hostname }}/{{ maas_dbname }}\""
