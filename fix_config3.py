with open('/opt/python/test_cuda/digital_human_cartoon/configs/config.yaml', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'AGENTS:' in line and 'SUPPORT_LIST' not in line:
        # next line should be SUPPORT_LIST
        if i+1 < len(lines) and 'SUPPORT_LIST' in lines[i+1] and 'longcatAgent.yaml' not in lines[i+1]:
            old_line = lines[i+1]
            new_line = old_line.rstrip()
            # remove trailing ]
            new_line = new_line.rstrip()
            if new_line.endswith(']'):
                new_line = new_line[:-1].rstrip() + ', "longcatAgent.yaml" ]\n'
            lines[i+1] = new_line
            print(f'Updated line {i+1}: {lines[i+1]}')
        elif 'longcatAgent.yaml' in lines[i+1]:
            print('Already has longcatAgent.yaml')

with open('/opt/python/test_cuda/digital_human_cartoon/configs/config.yaml', 'w') as f:
    f.writelines(lines)

print('Final config:')
print(open('/opt/python/test_cuda/digital_human_cartoon/configs/config.yaml').read())
