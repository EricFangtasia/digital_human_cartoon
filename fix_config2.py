content = open('/opt/python/test_cuda/digital_human_cartoon/configs/config.yaml').read()
old = 'SUPPORT_LIST: [ "repeaterAgent.yaml", "openaiAPI.yaml", "difyAgent.yaml", "fastgptAgent.yaml", "cozeAgent.yaml" ]'
new = 'SUPPORT_LIST: [ "repeaterAgent.yaml", "openaiAPI.yaml", "difyAgent.yaml", "fastgptAgent.yaml", "cozeAgent.yaml", "longcatAgent.yaml" ]'
if 'longcatAgent.yaml' not in content:
    content = content.replace(old, new)
    open('/opt/python/test_cuda/digital_human_cartoon/configs/config.yaml', 'w').write(content)
    print('SUPPORT_LIST updated')
else:
    print('longcatAgent.yaml already in SUPPORT_LIST')
print(open('/opt/python/test_cuda/digital_human_cartoon/configs/config.yaml').read())
